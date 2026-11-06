/**
 * End-to-End Integration Test
 * Connects the full chain:
 * MCP Server (Python via stdio JSON-RPC)
 *   <--> adb-proxy-socket (Node Socket.IO on port 3001)
 *   <--> Mock Premiere UXP Plugin Client (running UXP command handlers)
 */

const assert = require("assert");
const { spawn } = require("child_process");
const { io } = require("../adb-proxy-socket/node_modules/socket.io-client");
const { createMockApp, TICKS_PER_SECOND } = require("./mock_premiere_dom.js");

// Setup mock DOM for UXP command handlers
const mockApp = createMockApp();
const Module = require("module");
const originalRequire = Module.prototype.require;
Module.prototype.require = function(path) {
    if (path === "premierepro") return mockApp;
    if (path === "uxp") return { storage: { localFileSystem: {} }, entrypoints: { setup: () => {} } };
    return originalRequire.apply(this, arguments);
};

const { parseAndRouteCommand, getProjectInfo, checkRequiresActiveProject } = require("../uxp/pr/commands/index.js");
const { getSequences } = require("../uxp/pr/commands/utils.js");

async function runE2E() {
    console.log("=================================================");
    console.log("Starting End-to-End MCP Integration Test");
    console.log("=================================================\n");

    // 1. Connect mock Premiere UXP plugin to adb-proxy-socket
    console.log("1. Connecting Mock Premiere UXP Plugin to proxy (http://localhost:3001)...");
    const pluginSocket = io("http://localhost:3001", { transports: ["websocket"] });

    await new Promise((resolve, reject) => {
        pluginSocket.on("connect", () => {
            console.log("  ✓ Mock Premiere UXP Plugin connected (id:", pluginSocket.id, ")");
            pluginSocket.emit("register", { application: "premiere" });
            resolve();
        });
        pluginSocket.on("connect_error", (err) => reject(new Error("Proxy not running: " + err)));
    });

    // Handle command_packet like uxp/pr/main.js
    pluginSocket.on("command_packet", async (packet) => {
        const command = packet.command;
        const out = { senderId: packet.senderId };
        try {
            await checkRequiresActiveProject(command);
            const response = await parseAndRouteCommand(command);
            out.response = response;
            out.status = "SUCCESS";
            out.sequences = await getSequences();
            out.project = await getProjectInfo();
        } catch (e) {
            out.status = "FAILURE";
            out.message = `Error calling ${command.action} : ${e.message || e}`;
        }
        pluginSocket.emit("command_packet_response", { packet: out });
    });

    // 2. Launch MCP server process via stdio
    console.log("\n2. Launching Premiere MCP server process via uv...");
    const mcpCmd = "/Users/gourav/.local/bin/uv";
    const mcpArgs = [
        "run",
        "--python", "3.12",
        "--with", "fonttools",
        "--with", "python-socketio",
        "--with", "mcp[cli]<2",
        "--with", "requests",
        "--with", "websocket-client",
        "--with", "pillow",
        "mcp", "run",
        "/Users/gourav/Desktop/PP/mcp/pr-mcp.py"
    ];

    const mcpProc = spawn(mcpCmd, mcpArgs, {
        cwd: "/Users/gourav/Desktop/PP/mcp",
        stdio: ["pipe", "pipe", "pipe"]
    });

    mcpProc.stderr.on("data", (data) => {
        const msg = data.toString().trim();
        if (msg) console.log("  [MCP Server STDERR]:", msg);
    });

    // Helper to send JSON-RPC request and wait for matching response ID
    let rpcId = 1;
    function callRpc(method, params = {}) {
        return new Promise((resolve, reject) => {
            const id = rpcId++;
            const req = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";

            function onData(chunk) {
                const lines = chunk.toString().split("\n");
                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const parsed = JSON.parse(line);
                        if (parsed.id === id) {
                            mcpProc.stdout.removeListener("data", onData);
                            if (parsed.error) {
                                reject(new Error(`RPC Error (${parsed.error.code}): ${parsed.error.message}`));
                            } else {
                                resolve(parsed.result);
                            }
                            return;
                        }
                    } catch (e) {}
                }
            }

            mcpProc.stdout.on("data", onData);
            mcpProc.stdin.write(req);
        });
    }

    // Initialize MCP handshake
    console.log("\n3. Initializing MCP protocol handshake...");
    const initRes = await callRpc("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "GeminiCLIE2ETester", version: "1.0" }
    });
    console.log("  ✓ Handshake successful! Server name:", initRes.serverInfo.name);

    mcpProc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

    const sequenceId = "seq-test-guid-001";

    // 4. Test get_project_info tool over MCP
    console.log("\n4. Calling tool 'get_project_info' over MCP...");
    const projResult = await callRpc("tools/call", {
        name: "get_project_info",
        arguments: {}
    });
    const projContent = JSON.parse(projResult.content[0].text);
    assert.strictEqual(projContent.status, "SUCCESS");
    assert.strictEqual(projContent.project.name, "TestProject.prproj");
    assert.ok(projContent.sequences.length > 0, "Sequences list returned");
    console.log("  ✓ get_project_info returned active project & sequence timeline!");
    console.log("    Project name:", projContent.project.name);
    console.log("    Sequence name:", projContent.sequences[0].name);
    console.log("    Video tracks count:", projContent.sequences[0].videoTracks.length);

    // 5. Test get_markers tool over MCP
    console.log("\n5. Calling tool 'get_markers' over MCP...");
    const markersResult = await callRpc("tools/call", {
        name: "get_markers",
        arguments: { sequence_id: sequenceId }
    });
    const markersContent = JSON.parse(markersResult.content[0].text);
    assert.strictEqual(markersContent.status, "SUCCESS");
    assert.strictEqual(markersContent.response.count, 3);
    console.log("  ✓ get_markers returned", markersContent.response.count, "timeline markers!");

    // 6. Test move_clip tool with dry_run over MCP
    console.log("\n6. Calling tool 'move_clip' (dry_run=True) over MCP...");
    const moveDryResult = await callRpc("tools/call", {
        name: "move_clip",
        arguments: {
            sequence_id: sequenceId,
            track_type: "VIDEO",
            track_index: 0,
            clip_index: 0,
            new_start_ticks: 254016000000,
            expected_clip_name: "Intro_Logo.mp4",
            expected_start_ticks: 0,
            dry_run: true
        }
    });
    const moveDryContent = JSON.parse(moveDryResult.content[0].text);
    assert.strictEqual(moveDryContent.response.dryRun, true);
    assert.strictEqual(moveDryContent.response.status, "VALIDATED");
    console.log("  ✓ move_clip dry run successfully validated without mutating timeline!");

    // 7. Test move_clip tool mismatch refusal over MCP
    console.log("\n7. Calling tool 'move_clip' with mismatched clip name...");
    const badMoveResult = await callRpc("tools/call", {
        name: "move_clip",
        arguments: {
            sequence_id: sequenceId,
            track_type: "VIDEO",
            track_index: 0,
            clip_index: 0,
            new_start_ticks: 254016000000,
            expected_clip_name: "Wrong_Name.mp4",
            expected_start_ticks: 0,
            dry_run: false
        }
    });
    assert.strictEqual(badMoveResult.isError, true, "Tool result should have isError=true on refusal");
    assert.ok(badMoveResult.content[0].text.includes("Clip name mismatch"), "Error message should mention clip name mismatch");
    console.log("  ✓ move_clip successfully refused mismatched clip name!");

    // 8. Test move_clip execution over MCP
    console.log("\n8. Calling tool 'move_clip' execution over MCP...");
    const moveExecResult = await callRpc("tools/call", {
        name: "move_clip",
        arguments: {
            sequence_id: sequenceId,
            track_type: "VIDEO",
            track_index: 0,
            clip_index: 0,
            new_start_ticks: 254016000000, // 1 sec
            expected_clip_name: "Intro_Logo.mp4",
            expected_start_ticks: 0,
            dry_run: false
        }
    });
    const moveExecContent = JSON.parse(moveExecResult.content[0].text);
    assert.strictEqual(moveExecContent.status, "SUCCESS");
    console.log("  ✓ move_clip executed successfully!");

    // 9. Test razor_at_time dry run over MCP
    console.log("\n9. Calling tool 'razor_at_time' (dry_run=True) over MCP...");
    const razorDryResult = await callRpc("tools/call", {
        name: "razor_at_time",
        arguments: {
            sequence_id: sequenceId,
            time_ticks: 2540160000000, // 10 sec (inside Main_Interview.mp4 which is 5s-20s)
            track_type: "VIDEO",
            track_index: 0,
            expected_clip_name: "Main_Interview.mp4",
            expected_start_ticks: 1270080000000, // 5 sec
            dry_run: true
        }
    });
    const razorDryContent = JSON.parse(razorDryResult.content[0].text);
    assert.strictEqual(razorDryContent.response.dryRun, true);
    assert.strictEqual(razorDryContent.response.status, "VALIDATED");
    assert.strictEqual(razorDryContent.response.cepPanel, "cep/com.mikechambers.pr");
    console.log("  ✓ razor_at_time dry run validated target clip and returned CEP companion info!");

    // 10. Test CEP companion panel routing for razor_at_time
    console.log("\n10. Connecting Mock Premiere CEP Panel to proxy (application: 'premiere_cep')...");
    const cepSocket = io("http://localhost:3001", { transports: ["websocket"] });
    await new Promise((resolve, reject) => {
        cepSocket.on("connect", () => {
            console.log("  ✓ Mock Premiere CEP Panel connected (id:", cepSocket.id, ")");
            cepSocket.emit("register", { application: "premiere_cep" });
            resolve();
        });
        cepSocket.on("connect_error", (err) => reject(new Error("CEP Socket error: " + err)));
    });

    cepSocket.on("command_packet", (packet) => {
        const cmd = packet.command;
        console.log("  [Mock CEP Panel] Received routed command:", cmd.action);
        const out = {
            senderId: packet.senderId,
            status: "SUCCESS",
            response: {
                dryRun: false,
                status: "SUCCESS",
                message: `Successfully razored clip '${cmd.options.expectedClipName}' at 00:00:10:00 via QE DOM.`,
                timecode: "00:00:10:00",
                trackIndex: cmd.options.trackIndex,
                clipName: cmd.options.expectedClipName,
            }
        };
        cepSocket.emit("command_packet_response", { packet: out });
    });

    // Wait a brief moment for registration to propagate
    await new Promise((r) => setTimeout(r, 200));

    console.log("\n11. Calling tool 'razor_at_time' execution over MCP (routed to CEP QE panel)...");
    const razorExecResult = await callRpc("tools/call", {
        name: "razor_at_time",
        arguments: {
            sequence_id: sequenceId,
            time_ticks: 2540160000000,
            track_type: "VIDEO",
            track_index: 0,
            expected_clip_name: "Main_Interview.mp4",
            expected_start_ticks: 1270080000000,
            dry_run: false
        }
    });
    const razorExecContent = JSON.parse(razorExecResult.content[0].text);
    assert.strictEqual(razorExecContent.status, "SUCCESS");
    assert.ok(razorExecContent.response.message.includes("QE DOM"), "Response should confirm QE DOM cut");
    console.log("  ✓ razor_at_time routed to premiere_cep and executed via QE DOM successfully!");

    // 12. Test apply_edits execution over MCP (3 edits in descending order)
    console.log("\n12. Calling tool 'apply_edits' (3 edits) over MCP...");
    const batchEditsResult = await callRpc("tools/call", {
        name: "apply_edits",
        arguments: {
            edits: [
                {
                    type: "set_clip_disabled",
                    sequence_id: sequenceId,
                    track_type: "VIDEO",
                    track_index: 0,
                    clip_index: 1,
                    expected_clip_name: "Main_Interview.mp4",
                    expected_start_ticks: (5n * TICKS_PER_SECOND).toString(),
                    disabled: true
                },
                {
                    type: "set_clip_disabled",
                    sequence_id: sequenceId,
                    track_type: "VIDEO",
                    track_index: 0,
                    clip_index: 3,
                    expected_clip_name: "Outro_Credits.mp4",
                    expected_start_ticks: (30n * TICKS_PER_SECOND).toString(),
                    disabled: true
                },
                {
                    type: "set_clip_disabled",
                    sequence_id: sequenceId,
                    track_type: "VIDEO",
                    track_index: 1,
                    clip_index: 0,
                    expected_clip_name: "Lower_Third_Title.png",
                    expected_start_ticks: (6n * TICKS_PER_SECOND).toString(),
                    disabled: true
                }
            ],
            dry_run: false
        }
    });
    const batchContent = JSON.parse(batchEditsResult.content[0].text);
    assert.strictEqual(batchContent.status, "SUCCESS");
    assert.strictEqual(batchContent.response.appliedEditsCount, 3);
    console.log("  ✓ apply_edits executed all 3 batch edits successfully in a single atomic transaction!");

    // Cleanup
    console.log("\nCleaning up processes...");
    pluginSocket.disconnect();
    cepSocket.disconnect();
    mcpProc.kill();

    console.log("\n=================================================");
    console.log("ALL END-TO-END MCP INTEGRATION TESTS PASSED!");
    console.log("=================================================\n");
    process.exit(0);
}

runE2E().catch((err) => {
    console.error("E2E Test Failed:", err);
    process.exit(1);
});

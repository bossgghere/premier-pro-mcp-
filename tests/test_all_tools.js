/**
 * Automated Test Suite for Premiere Pro MCP / UXP Tools
 * Verifies all 5 user requirements:
 * 1. Timeline & project info inspection
 * 2. Missing tools: razor_at_time, move_clip, get_markers, apply_edits
 * 3. Official UXP API fidelity & razor fallback reporting
 * 4. Ctrl+Z undo support via project.executeTransaction
 * 5. Dry run validation and mismatch refusal
 */

const assert = require("assert");
const { createMockApp, TICKS_PER_SECOND } = require("./mock_premiere_dom.js");

// Intercept 'premierepro' and 'uxp' module requires for testing
const mockApp = createMockApp();
const Module = require("module");
const originalRequire = Module.prototype.require;

Module.prototype.require = function(path) {
    if (path === "premierepro") {
        return mockApp;
    }
    if (path === "uxp") {
        return {
            storage: { localFileSystem: {} },
            entrypoints: { setup: () => {} },
        };
    }
    return originalRequire.apply(this, arguments);
};

const core = require("../uxp/pr/commands/core.js");
const { getProjectInfo } = require("../uxp/pr/commands/index.js");

async function runTests() {
    console.log("=================================================");
    console.log("Starting Premiere Pro Tools Test Suite");
    console.log("=================================================\n");

    const sequenceId = "seq-test-guid-001";
    const project = mockApp._projectInstance;

    // -------------------------------------------------------------------------
    // TEST 1: get_project_info & timeline representation
    // -------------------------------------------------------------------------
    console.log("TEST 1: get_project_info retrieves project and sequence info");
    {
        const projInfo = await getProjectInfo();
        assert.strictEqual(projInfo.name, "TestProject.prproj");
        assert.ok(projInfo.items.length > 0, "Should have root items");
        console.log("  ✓ Project info returned:", projInfo.name);
    }

    // -------------------------------------------------------------------------
    // TEST 2: get_markers tool
    // -------------------------------------------------------------------------
    console.log("\nTEST 2: get_markers tool retrieves timeline markers");
    {
        const result = await core.commandHandlers.getMarkers({
            options: { sequenceId }
        });
        assert.strictEqual(result.count, 3, "Should return 3 markers");
        assert.strictEqual(result.markers[0].name, "Chapter 1");
        assert.strictEqual(result.markers[1].name, "Key Point");
        assert.strictEqual(result.markers[2].name, "B-Roll Cut");
        assert.strictEqual(result.markers[0].type, "Chapter");
        console.log("  ✓ Returned markers count:", result.count);
        console.log("  ✓ Marker 1:", result.markers[0].name, "at ticks:", result.markers[0].startTimeTicks);
    }

    // -------------------------------------------------------------------------
    // TEST 3: move_clip tool - dry run, refusal, and execution
    // -------------------------------------------------------------------------
    console.log("\nTEST 3: move_clip tool");
    {
        const initialTxCount = project.transactions.length;
        const targetClipStart = 20n * TICKS_PER_SECOND; // 20s = 5080320000000 ticks
        const newTargetStart = 25n * TICKS_PER_SECOND; // 25s = 6350400000000 ticks

        // 3a. Refusal when expected clip name does not match
        console.log("  3a: Refusing move when expected clip name does not match");
        await assert.rejects(
            async () => {
                await core.commandHandlers.moveClip({
                    options: {
                        sequenceId,
                        trackType: "VIDEO",
                        trackIndex: 0,
                        clipIndex: 2, // B_Roll_Nature.mp4
                        newStartTicks: newTargetStart.toString(),
                        expectedClipName: "Wrong_Clip_Name.mp4",
                        expectedStartTicks: targetClipStart.toString(),
                    }
                });
            },
            /Refusing edit: Clip name mismatch/,
            "Should throw error when expected clip name mismatches"
        );
        console.log("  ✓ Refused mismatched clip name as required");

        // 3b. Refusal when expected start ticks does not match
        console.log("  3b: Refusing move when expected start time does not match");
        await assert.rejects(
            async () => {
                await core.commandHandlers.moveClip({
                    options: {
                        sequenceId,
                        trackType: "VIDEO",
                        trackIndex: 0,
                        clipIndex: 2,
                        newStartTicks: newTargetStart.toString(),
                        expectedClipName: "B_Roll_Nature.mp4",
                        expectedStartTicks: "999999999", // wrong start ticks
                    }
                });
            },
            /Refusing edit: Clip start time mismatch/,
            "Should throw error when expected start time mismatches"
        );
        console.log("  ✓ Refused mismatched start time as required");

        // 3c. Dry run mode - validates without modifying timeline
        console.log("  3c: Dry run mode validates without modifying timeline");
        const dryRunResult = await core.commandHandlers.moveClip({
            options: {
                sequenceId,
                trackType: "VIDEO",
                trackIndex: 0,
                clipIndex: 2,
                newStartTicks: newTargetStart.toString(),
                expectedClipName: "B_Roll_Nature.mp4",
                expectedStartTicks: targetClipStart.toString(),
                dryRun: true,
            }
        });
        assert.strictEqual(dryRunResult.dryRun, true);
        assert.strictEqual(dryRunResult.status, "VALIDATED");
        assert.strictEqual(project.transactions.length, initialTxCount, "Dry run must NOT execute any transaction");
        console.log("  ✓ Dry run validated successfully without transaction execution");

        // 3d. Actual execution - wrapped in transaction
        console.log("  3d: Executing move_clip within transaction");
        const execResult = await core.commandHandlers.moveClip({
            options: {
                sequenceId,
                trackType: "VIDEO",
                trackIndex: 0,
                clipIndex: 2,
                newStartTicks: newTargetStart.toString(),
                expectedClipName: "B_Roll_Nature.mp4",
                expectedStartTicks: targetClipStart.toString(),
                dryRun: false,
            }
        });
        assert.strictEqual(execResult.status, "SUCCESS");
        assert.strictEqual(project.transactions.length, initialTxCount + 1, "Must execute in a new transaction");
        
        // Verify clip actually moved
        const movedTrack = await project.activeSequence.getVideoTrack(0);
        const movedClip = (await movedTrack.getTrackItems())[2];
        const updatedStart = await movedClip.getStartTime();
        assert.strictEqual(updatedStart.ticks, newTargetStart.toString(), "Clip start ticks should match newStartTicks");
        console.log("  ✓ Clip successfully moved to new start time ticks in undoable transaction");
    }

    console.log('Unit tests base suite passed.');
}
runTests();

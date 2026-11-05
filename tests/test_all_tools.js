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

    // -------------------------------------------------------------------------
    // TEST 4: razor_at_time tool - validation & honest UXP fallback reporting
    // -------------------------------------------------------------------------
    console.log("\nTEST 4: razor_at_time tool");
    {
        const cutTimeTicks = (10n * TICKS_PER_SECOND).toString(); // 10 seconds into Main_Interview.mp4

        // 4a. Mismatch refusal
        console.log("  4a: Refusing razor when expected clip name mismatches");
        await assert.rejects(
            async () => {
                await core.commandHandlers.razorAtTime({
                    options: {
                        sequenceId,
                        timeTicks: cutTimeTicks,
                        trackType: "VIDEO",
                        trackIndex: 0,
                        expectedClipName: "Non_Existent_Clip.mp4",
                        expectedStartTicks: (5n * TICKS_PER_SECOND).toString(),
                    }
                });
            },
            /Refusing edit: Clip name mismatch/
        );
        console.log("  ✓ Refused mismatched clip name on razor");

        console.log("  4b: Refusing razor when expected start time mismatches");
        await assert.rejects(
            async () => {
                await core.commandHandlers.razorAtTime({
                    options: {
                        sequenceId,
                        timeTicks: cutTimeTicks,
                        trackType: "VIDEO",
                        trackIndex: 0,
                        expectedClipName: "Main_Interview.mp4",
                        expectedStartTicks: (999n * TICKS_PER_SECOND).toString(),
                    }
                });
            },
            /Refusing edit: Clip start time mismatch/
        );
        console.log("  ✓ Refused mismatched start ticks on razor");

        // 4c. Dry run validation
        console.log("  4c: Dry run identifies target clip and reports CEP companion panel");
        const dryRunCut = await core.commandHandlers.razorAtTime({
            options: {
                sequenceId,
                timeTicks: cutTimeTicks,
                trackType: "VIDEO",
                trackIndex: 0,
                expectedClipName: "Main_Interview.mp4",
                expectedStartTicks: (5n * TICKS_PER_SECOND).toString(),
                dryRun: true,
            }
        });
        assert.strictEqual(dryRunCut.dryRun, true);
        assert.strictEqual(dryRunCut.status, "VALIDATED");
        assert.strictEqual(dryRunCut.targetClips[0].clipName, "Main_Interview.mp4");
        assert.strictEqual(dryRunCut.cepPanel, "cep/com.mikechambers.pr");
        console.log("  ✓ Dry run validated target clip and reported CEP companion panel");

        // 4d. Honest reporting that official Premiere UXP DOM lacks native razor method
        console.log("  4d: Verifying official UXP API fidelity (requires CEP companion panel for QE cut)");
        await assert.rejects(
            async () => {
                await core.commandHandlers.razorAtTime({
                    options: {
                        sequenceId,
                        timeTicks: cutTimeTicks,
                        trackType: "VIDEO",
                        trackIndex: 0,
                        expectedClipName: "Main_Interview.mp4",
                        expectedStartTicks: (5n * TICKS_PER_SECOND).toString(),
                        dryRun: false,
                    }
                });
            },
            /razor_at_time requires the Premiere Pro CEP companion panel/
        );
        console.log("  ✓ Correctly rejected faking and instructed use of CEP panel for QE razor");
    }

    // -------------------------------------------------------------------------
    // TEST 5: apply_edits tool - descending order & single atomic transaction
    // -------------------------------------------------------------------------
    console.log("\nTEST 5: apply_edits tool (latest-to-earliest ordering & atomic Ctrl+Z)");
    {
        const txBefore = project.transactions.length;

        // Provide edits in scrambled chronological order:
        // Edit A: 5s
        // Edit B: 30s
        // Edit C: 6s (on Track 1)
        const editA = {
            type: "set_clip_disabled",
            sequenceId,
            trackType: "VIDEO",
            trackIndex: 0,
            clipIndex: 1, // Main_Interview.mp4 (start: 5s = 1270080000000)
            expectedClipName: "Main_Interview.mp4",
            expectedStartTicks: (5n * TICKS_PER_SECOND).toString(),
            disabled: true,
        };

        const editB = {
            type: "set_clip_disabled",
            sequenceId,
            trackType: "VIDEO",
            trackIndex: 0,
            clipIndex: 3, // Outro_Credits.mp4 (start: 30s = 7620480000000)
            expectedClipName: "Outro_Credits.mp4",
            expectedStartTicks: (30n * TICKS_PER_SECOND).toString(),
            disabled: true,
        };

        const editC = {
            type: "set_clip_disabled",
            sequenceId,
            trackType: "VIDEO",
            trackIndex: 1,
            clipIndex: 0, // Lower_Third_Title.png (start: 6s = 1524096000000)
            expectedClipName: "Lower_Third_Title.png",
            expectedStartTicks: (6n * TICKS_PER_SECOND).toString(),
            disabled: true,
        };

        // 5a. Dry run verifies latest-to-earliest sort order
        console.log("  5a: Dry run verifies execution plan is sorted latest to earliest");
        const dryRunBatch = await core.commandHandlers.applyEdits({
            options: {
                edits: [editA, editB, editC], // Order: 5s, 30s, 6s
                dryRun: true,
            }
        });
        assert.strictEqual(dryRunBatch.dryRun, true);
        assert.strictEqual(dryRunBatch.status, "VALIDATED");
        const plan = dryRunBatch.executionPlan;
        assert.strictEqual(plan[0].clipName, "Outro_Credits.mp4", "First should be 30s");
        assert.strictEqual(plan[1].clipName, "Lower_Third_Title.png", "Second should be 6s");
        assert.strictEqual(plan[2].clipName, "Main_Interview.mp4", "Third should be 5s");
        console.log("  ✓ Correctly sorted latest (30s) -> middle (6s) -> earliest (5s)");

        // 5b. Refusal if ANY edit in batch fails validation
        console.log("  5b: Refusing entire batch if one edit has mismatched clip name");
        const badBatch = [
            editA,
            { ...editB, expectedClipName: "Wrong_Name.mp4" },
            editC
        ];
        await assert.rejects(
            async () => {
                await core.commandHandlers.applyEdits({
                    options: { edits: badBatch, dryRun: false }
                });
            },
            /Refusing edit: Clip name mismatch/
        );
        assert.strictEqual(project.transactions.length, txBefore, "No transaction should be executed on refusal");
        console.log("  ✓ Aborted entire batch before applying any changes");

        // 5c. Actual batch execution - single atomic transaction for Ctrl+Z
        console.log("  5c: Executing batch edits in a SINGLE atomic transaction");
        const batchResult = await core.commandHandlers.applyEdits({
            options: {
                edits: [editA, editB, editC],
                dryRun: false,
            }
        });
        assert.strictEqual(batchResult.status, "SUCCESS");
        assert.strictEqual(batchResult.appliedEditsCount, 3);
        assert.strictEqual(project.transactions.length, txBefore + 1, "Exactly ONE transaction added for all edits (Ctrl+Z)");
        
        const compoundTx = project.transactions[project.transactions.length - 1];
        assert.strictEqual(compoundTx.actions.length, 3, "Compound transaction must contain all 3 actions");
        console.log("  ✓ All 3 edits committed in 1 single transaction (undoable with 1 Ctrl+Z)");
    }

    console.log("\n=================================================");
    console.log("ALL UNIT TESTS PASSED SUCCESSFULLY! (100% Green)");
    console.log("=================================================\n");
}

runTests().catch((err) => {
    console.error("Test failed with error:", err);
    process.exit(1);
});

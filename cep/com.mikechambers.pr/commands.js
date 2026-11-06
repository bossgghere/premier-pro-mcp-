/* commands.js
 * Premiere Pro CEP command handlers via QE DOM & ExtendScript
 */

function executeScript(script) {
    return new Promise((resolve, reject) => {
        if (typeof CSInterface === "undefined") {
            reject(new Error("CSInterface not available. Run inside CEP panel."));
            return;
        }
        const csInterface = new CSInterface();
        csInterface.evalScript(script, (result) => {
            if (result === "EvalScript error.") {
                reject(new Error("ExtendScript execution failed: EvalScript error."));
            } else {
                try {
                    resolve(JSON.parse(result));
                } catch (e) {
                    resolve(result);
                }
            }
        });
    });
}

/**
 * Executes razor cut on Premiere timeline via QE DOM.
 * Enforces expected_clip_name and expected_start_ticks validation guards.
 */
async function razorAtTime(command) {
    const options = command.options || {};
    const sequenceId = options.sequenceId;
    const timeTicks = options.timeTicks;
    const trackType = (options.trackType || "VIDEO").toUpperCase();
    const trackIndex = options.trackIndex !== undefined && options.trackIndex !== null ? Number(options.trackIndex) : 0;
    const expectedClipName = options.expectedClipName;
    const expectedStartTicks = options.expectedStartTicks;
    const dryRun = Boolean(options.dryRun);

    // Require guards
    if (!expectedClipName) {
        throw new Error("Refusing edit: 'expected_clip_name' is required to guard against timeline desynchronization.");
    }
    if (expectedStartTicks === undefined || expectedStartTicks === null || expectedStartTicks === "") {
        throw new Error("Refusing edit: 'expected_start_ticks' is required to guard against timeline desynchronization.");
    }

    const script = `
        (function() {
            try {
                app.enableQE();
                if (typeof qe === "undefined" || !qe.project) {
                    return JSON.stringify({
                        status: "FAILURE",
                        message: "QE DOM could not be enabled. Ensure a project is open in Premiere Pro."
                    });
                }

                var qeSeq = qe.project.getActiveSequence();
                if (!qeSeq) {
                    return JSON.stringify({
                        status: "FAILURE",
                        message: "No active sequence found in QE DOM."
                    });
                }

                var stdSeq = app.project.activeSequence;
                if (!stdSeq) {
                    return JSON.stringify({
                        status: "FAILURE",
                        message: "No active sequence found in standard ExtendScript DOM."
                    });
                }

                var trackType = "${trackType}";
                var trackIndex = ${trackIndex};
                var timeTicksStr = "${timeTicks}";
                var expectedName = ${JSON.stringify(expectedClipName)};
                var expectedStartStr = "${expectedStartTicks}";
                var isDryRun = ${dryRun};

                var stdTrack = (trackType === "VIDEO") ? stdSeq.videoTracks[trackIndex] : stdSeq.audioTracks[trackIndex];
                if (!stdTrack) {
                    return JSON.stringify({
                        status: "FAILURE",
                        message: "Track index " + trackIndex + " (" + trackType + ") not found on sequence."
                    });
                }

                // Locate the target clip spanning the cut time
                var cutTicksNum = parseFloat(timeTicksStr);
                var targetClip = null;
                var clipIndex = -1;

                for (var i = 0; i < stdTrack.clips.numItems; i++) {
                    var clip = stdTrack.clips[i];
                    var startTicks = parseFloat(clip.start.ticks);
                    var endTicks = parseFloat(clip.end.ticks);
                    if (cutTicksNum >= startTicks && cutTicksNum <= endTicks) {
                        targetClip = clip;
                        clipIndex = i;
                        break;
                    }
                }

                if (!targetClip) {
                    return JSON.stringify({
                        status: "FAILURE",
                        message: "razorAtTime: No clip found on " + trackType + " track " + trackIndex + " spanning " + timeTicksStr + " ticks."
                    });
                }

                // Guard validation: clip name
                if (targetClip.name !== expectedName) {
                    return JSON.stringify({
                        status: "FAILURE",
                        message: "Refusing edit: Clip name mismatch on " + trackType + " track " + trackIndex + ", clip " + clipIndex + ". Expected '" + expectedName + "', but found '" + targetClip.name + "'. Timeline may have shifted."
                    });
                }

                // Guard validation: clip start time
                if (targetClip.start.ticks !== expectedStartStr) {
                    return JSON.stringify({
                        status: "FAILURE",
                        message: "Refusing edit: Clip start time mismatch on " + trackType + " track " + trackIndex + ", clip " + clipIndex + ". Expected " + expectedStartStr + " ticks, but found " + targetClip.start.ticks + " ticks. Timeline may have shifted."
                    });
                }

                // Convert ticks to exact Premiere sequence timecode string (HH:MM:SS:FF)
                var targetTime = new Time();
                targetTime.ticks = timeTicksStr;
                var timecodeString = "";
                try {
                    var settings = stdSeq.getSettings();
                    timecodeString = targetTime.getFormatted(settings.videoFrameRate, stdSeq.videoDisplayFormat);
                } catch (eFormat) {
                    // Fallback timecode calculation if getSettings is unavailable
                    var totalSec = targetTime.seconds;
                    var hrs = Math.floor(totalSec / 3600);
                    var rem = totalSec % 3600;
                    var mins = Math.floor(rem / 60);
                    var secs = Math.floor(rem % 60);
                    var frms = Math.floor((rem - secs) * 25);
                    function pad(n) { return (n < 10 ? "0" : "") + n; }
                    timecodeString = pad(hrs) + ":" + pad(mins) + ":" + pad(secs) + ":" + pad(frms);
                }

                if (isDryRun) {
                    return JSON.stringify({
                        status: "SUCCESS",
                        response: {
                            dryRun: true,
                            status: "VALIDATED",
                            message: "Dry run: Clip '" + targetClip.name + "' on " + trackType + " track " + trackIndex + " validated for QE razor cut at " + timecodeString + " (" + timeTicksStr + " ticks).",
                            clipName: targetClip.name,
                            trackType: trackType,
                            trackIndex: trackIndex,
                            clipIndex: clipIndex,
                            timecode: timecodeString,
                            timeTicks: timeTicksStr
                        }
                    });
                }

                // Execute QE DOM Razor Cut
                var qeTrack = (trackType === "VIDEO") ? qeSeq.getVideoTrackAt(trackIndex) : qeSeq.getAudioTrackAt(trackIndex);
                if (!qeTrack) {
                    return JSON.stringify({
                        status: "FAILURE",
                        message: "QE Track not found at index " + trackIndex + " (" + trackType + ")."
                    });
                }

                // Exact QE razor signature: qeTrack.razor(timecodeString)
                qeTrack.razor(timecodeString);

                return JSON.stringify({
                    status: "SUCCESS",
                    response: {
                        dryRun: false,
                        status: "SUCCESS",
                        message: "Successfully razored clip '" + targetClip.name + "' on " + trackType + " track " + trackIndex + " at " + timecodeString + " via QE DOM.",
                        clipName: targetClip.name,
                        trackType: trackType,
                        trackIndex: trackIndex,
                        timecode: timecodeString,
                        timeTicks: timeTicksStr
                    }
                });
            } catch (err) {
                return JSON.stringify({
                    status: "FAILURE",
                    message: "QE DOM Razor execution error: " + err.toString()
                });
            }
        })();
    `;

    const result = await executeScript(script);
    if (result && result.status === "FAILURE") {
        throw new Error(result.message || "QE Razor failed");
    }
    return result ? result.response : { status: "SUCCESS" };
}

const commandHandlers = {
    razorAtTime,
};

async function parseAndRouteCommand(command) {
    const action = command.action;
    const handler = commandHandlers[action];
    if (typeof handler !== "function") {
        throw new Error(`Unknown CEP Command: ${action}`);
    }
    return await handler(command);
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        razorAtTime,
        parseAndRouteCommand,
        commandHandlers,
    };
}

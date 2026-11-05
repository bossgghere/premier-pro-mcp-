/**
 * Adobe Premiere Pro QE DOM Razor Automation Helper
 *
 * BACKGROUND:
 * In Adobe Premiere Pro's official UXP DOM API (v25+), there is no native
 * razor() or split() method on TrackItem, Track, or SequenceEditor.
 * Furthermore, in standard Premiere Pro ExtendScript, TrackItem does NOT possess
 * a .razor() method.
 *
 * Programmatic timeline slicing in Premiere Pro is achieved exclusively via the
 * QE (Quality Engineering) DOM:
 *   app.enableQE();
 *   var qeSeq = qe.project.getActiveSequence();
 *   qeSeq.getVideoTrackAt(trackIndex).razor(timecodeString); // e.g. "00:00:05:00"
 *
 * This script is executed natively inside Premiere Pro via the companion CEP panel:
 *   cep/com.mikechambers.pr
 */

(function(global) {
    if (typeof qe === "undefined") {
        app.enableQE();
    }

    /**
     * Splits the clip on a specific track at the given time using the QE DOM.
     * @param {string} trackType - "VIDEO" or "AUDIO"
     * @param {number} trackIndex - 0-based track index
     * @param {string|number} timeTicksOrSeconds - Time in ticks or seconds
     * @returns {object} Status object with success and details
     */
    function razorClipAtTime(trackType, trackIndex, timeTicksOrSeconds) {
        var qeSeq = qe.project.getActiveSequence();
        if (!qeSeq) {
            return {
                success: false,
                error: "No active sequence found in QE DOM. Please ensure a sequence is open in Premiere Pro."
            };
        }

        var stdSeq = app.project.activeSequence;
        if (!stdSeq) {
            return {
                success: false,
                error: "No active sequence found in standard ExtendScript DOM."
            };
        }

        var isVideo = (trackType.toUpperCase() === "VIDEO");
        var qeTrack = isVideo ? qeSeq.getVideoTrackAt(trackIndex) : qeSeq.getAudioTrackAt(trackIndex);

        if (!qeTrack) {
            return {
                success: false,
                error: "QE Track index " + trackIndex + " (" + trackType + ") not found."
            };
        }

        // Convert time to exact sequence timecode string (HH:MM:SS:FF)
        var t = new Time();
        if (typeof timeTicksOrSeconds === "string" && timeTicksOrSeconds.length > 10) {
            t.ticks = timeTicksOrSeconds;
        } else {
            t.seconds = parseFloat(timeTicksOrSeconds);
        }

        var timecodeString = "";
        try {
            var settings = stdSeq.getSettings();
            timecodeString = t.getFormatted(settings.videoFrameRate, stdSeq.videoDisplayFormat);
        } catch (e) {
            var totalSec = t.seconds;
            var hrs = Math.floor(totalSec / 3600);
            var rem = totalSec % 3600;
            var mins = Math.floor(rem / 60);
            var secs = Math.floor(rem % 60);
            var frms = Math.floor((rem - secs) * 25);
            function pad(n) { return (n < 10 ? "0" : "") + n; }
            timecodeString = pad(hrs) + ":" + pad(mins) + ":" + pad(secs) + ":" + pad(frms);
        }

        try {
            // Exact QE DOM signature: qeTrack.razor(timecodeString)
            qeTrack.razor(timecodeString);
            return {
                success: true,
                method: "qeTrack.razor(timecode)",
                trackType: trackType,
                trackIndex: trackIndex,
                timecode: timecodeString,
                timeTicks: t.ticks
            };
        } catch (qeErr) {
            return {
                success: false,
                error: "QE Track razor failed: " + qeErr.toString()
            };
        }
    }

    /**
     * Splits all video and audio tracks at the specified time position.
     * @param {string|number} timeTicksOrSeconds - Time in ticks or seconds
     * @returns {object} Status object
     */
    function razorAllTracksAtTime(timeTicksOrSeconds) {
        var qeSeq = qe.project.getActiveSequence();
        if (!qeSeq) {
            return { success: false, error: "No active sequence found." };
        }

        var t = new Time();
        if (typeof timeTicksOrSeconds === "string" && timeTicksOrSeconds.length > 10) {
            t.ticks = timeTicksOrSeconds;
        } else {
            t.seconds = parseFloat(timeTicksOrSeconds);
        }

        var timecodeString = t.getFormatted(app.project.activeSequence.getSettings().videoFrameRate, app.project.activeSequence.videoDisplayFormat);

        try {
            qeSeq.razor(timecodeString);
            return {
                success: true,
                method: "qeSeq.razor(timecode)",
                timecode: timecodeString
            };
        } catch (e) {
            return {
                success: false,
                error: "QE global razor failed: " + e.toString()
            };
        }
    }

    global.razorClipAtTime = razorClipAtTime;
    global.razorAllTracksAtTime = razorAllTracksAtTime;
})(this);

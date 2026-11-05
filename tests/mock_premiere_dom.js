/**
 * High-fidelity Mock for Adobe Premiere Pro UXP DOM
 * Accurately models sequences, video/audio tracks, clips, TickTime, markers,
 * and undoable transactions (project.executeTransaction).
 */

const TICKS_PER_SECOND = 254016000000n;

class MockTickTime {
    constructor(ticksStr) {
        this.ticks = ticksStr.toString();
        this.ticksNumber = Number(ticksStr);
        this.seconds = Number(BigInt(ticksStr)) / Number(TICKS_PER_SECOND);
    }

    static createWithTicks(ticksStr) {
        return new MockTickTime(ticksStr);
    }

    static createWithSeconds(sec) {
        const ticks = BigInt(Math.round(sec * Number(TICKS_PER_SECOND)));
        return new MockTickTime(ticks.toString());
    }
}

class MockTrackItem {
    constructor({ name, startSeconds, durationSeconds, trackType, trackIndex, clipIndex }) {
        this.name = name;
        this.trackType = trackType;
        this.trackIndex = trackIndex;
        this.clipIndex = clipIndex;
        this.disabled = false;

        const startTicks = BigInt(Math.round(startSeconds * Number(TICKS_PER_SECOND)));
        const durTicks = BigInt(Math.round(durationSeconds * Number(TICKS_PER_SECOND)));
        const endTicks = startTicks + durTicks;

        this._startTime = new MockTickTime(startTicks.toString());
        this._duration = new MockTickTime(durTicks.toString());
        this._endTime = new MockTickTime(endTicks.toString());
        this.projectItem = { name: name };
    }

    async getStartTime() { return this._startTime; }
    async getEndTime() { return this._endTime; }
    async getDuration() { return this._duration; }
    async getName() { return this.name; }
    async getProjectItem() { return this.projectItem; }
    async getType() { return "CLIP"; }
    async isDisabled() { return this.disabled; }

    createMoveAction(shiftTick) {
        return {
            type: "MOVE",
            item: this,
            shiftTick,
            apply: () => {
                const shiftBig = BigInt(shiftTick.ticks);
                const newStartBig = BigInt(this._startTime.ticks) + shiftBig;
                const newEndBig = BigInt(this._endTime.ticks) + shiftBig;
                this._startTime = new MockTickTime(newStartBig.toString());
                this._endTime = new MockTickTime(newEndBig.toString());
            }
        };
    }

    createSetStartAction(tick) {
        return {
            type: "SET_START",
            item: this,
            tick,
            apply: () => {
                this._startTime = new MockTickTime(tick.ticks);
            }
        };
    }

    createSetEndAction(tick) {
        return {
            type: "SET_END",
            item: this,
            tick,
            apply: () => {
                this._endTime = new MockTickTime(tick.ticks);
            }
        };
    }

    createSetDisabledAction(disabled) {
        return {
            type: "SET_DISABLED",
            item: this,
            disabled,
            apply: () => {
                this.disabled = disabled;
            }
        };
    }
}

class MockTrack {
    constructor(index, type, clipConfigs = []) {
        this.index = index;
        this.type = type;
        this.isMuted = false;
        this.clips = clipConfigs.map((c, i) => new MockTrackItem({
            ...c,
            trackType: type,
            trackIndex: index,
            clipIndex: i,
        }));
    }

    async getTrackItems(type, includeEmpty) {
        return this.clips;
    }

    setMute(m) {
        this.isMuted = m;
    }
}

class MockMarker {
    constructor({ name, comments, startSeconds, durationSeconds, type = "Comment" }) {
        this.name = name;
        this.comments = comments;
        this.type = type;
        this.guid = { toString: () => "marker-guid-" + name };
        this._start = MockTickTime.createWithSeconds(startSeconds);
        this._duration = MockTickTime.createWithSeconds(durationSeconds);
        this.colorIndex = 0;
    }

    async getName() { return this.name; }
    async getComments() { return this.comments; }
    async getType() { return this.type; }
    async getStart() { return this._start; }
    async getDuration() { return this._duration; }
    async getColorIndex() { return this.colorIndex; }
}

class MockMarkersManager {
    constructor(markers = []) {
        this.markers = markers.map(m => new MockMarker(m));
    }

    getMarkers() {
        return this.markers;
    }

    createAddMarkerAction(name, markerType, startTime, duration, comments) {
        return {
            type: "ADD_MARKER",
            apply: () => {
                this.markers.push(new MockMarker({
                    name,
                    comments,
                    startSeconds: startTime.seconds,
                    durationSeconds: duration.seconds,
                    type: markerType,
                }));
            }
        };
    }
}

class MockSequence {
    constructor(id = "seq-test-guid-001", name = "Main Edit Sequence") {
        this.guid = { toString: () => id };
        this.name = name;

        // Initialize with realistic timeline tracks and clips
        this.videoTracks = [
            new MockTrack(0, "VIDEO", [
                { name: "Intro_Logo.mp4", startSeconds: 0, durationSeconds: 5 },
                { name: "Main_Interview.mp4", startSeconds: 5, durationSeconds: 15 },
                { name: "B_Roll_Nature.mp4", startSeconds: 20, durationSeconds: 10 },
                { name: "Outro_Credits.mp4", startSeconds: 30, durationSeconds: 5 },
            ]),
            new MockTrack(1, "VIDEO", [
                { name: "Lower_Third_Title.png", startSeconds: 6, durationSeconds: 4 },
                { name: "Callout_Text.png", startSeconds: 22, durationSeconds: 3 },
            ]),
        ];

        this.audioTracks = [
            new MockTrack(0, "AUDIO", [
                { name: "Interview_Voiceover.wav", startSeconds: 0, durationSeconds: 20 },
                { name: "Background_Music.mp3", startSeconds: 0, durationSeconds: 35 },
            ]),
        ];

        this.markersManager = new MockMarkersManager([
            { name: "Chapter 1", comments: "Intro begins", startSeconds: 0, durationSeconds: 0, type: "Chapter" },
            { name: "Key Point", comments: "Interview topic shift", startSeconds: 10, durationSeconds: 2, type: "Comment" },
            { name: "B-Roll Cut", comments: "Transition to outdoor shot", startSeconds: 20, durationSeconds: 0, type: "Comment" },
        ]);
    }

    async getVideoTrackCount() { return this.videoTracks.length; }
    async getAudioTrackCount() { return this.audioTracks.length; }
    async getVideoTrack(index) { return this.videoTracks[index]; }
    async getAudioTrack(index) { return this.audioTracks[index]; }
    async getTrack(index, type) {
        return type === "VIDEO" ? this.videoTracks[index] : this.audioTracks[index];
    }
    async getTimebase() { return 10160640000; }
    async getFrameSize() { return { width: 1920, height: 1080 }; }
    async getEndTime() { return MockTickTime.createWithSeconds(35); }
    async getSelection() {
        return {
            items: [],
            async getTrackItems() { return this.items; },
            addItem(item) { this.items.push(item); },
            removeItem(item) { this.items = this.items.filter(x => x !== item); }
        };
    }
}

class MockProject {
    constructor() {
        this.name = "TestProject.prproj";
        this.path = "/Users/gourav/Desktop/PP/TestProject.prproj";
        this.guid = { toString: () => "proj-guid-001" };
        this.activeSequence = new MockSequence();
        this.sequences = [this.activeSequence];
        this.transactions = [];
    }

    async getActiveProject() { return this; }
    async getActiveSequence() { return this.activeSequence; }
    async getSequences() { return this.sequences; }
    async getSequence(guid) {
        const idStr = guid.toString ? guid.toString() : guid;
        return this.sequences.find(s => s.guid.toString() === idStr);
    }
    async getRootItem() {
        return {
            name: "Root",
            async getItems() {
                return [
                    { name: "Intro_Logo.mp4" },
                    { name: "Main_Interview.mp4" },
                    { name: "B_Roll_Nature.mp4" },
                    { name: "Outro_Credits.mp4" },
                    { name: "Interview_Voiceover.wav" },
                    { name: "Background_Music.mp3" },
                ];
            }
        };
    }

    lockedAccess(fn) {
        return fn();
    }

    executeTransaction(fn) {
        const compoundAction = {
            actions: [],
            addAction: (a) => {
                compoundAction.actions.push(a);
                if (typeof a.apply === "function") {
                    a.apply();
                }
            }
        };
        fn(compoundAction);
        this.transactions.push(compoundAction);
    }
}

function createMockApp() {
    const project = new MockProject();
    return {
        Project: {
            getActiveProject: async () => project,
        },
        FolderItem: {
            cast: (item) => (item && item.isBin ? item : null),
        },
        TickTime: MockTickTime,
        Markers: {
            getMarkers: async (seq) => seq.markersManager,
        },
        Guid: {
            fromString: (str) => ({ toString: () => str }),
        },
        Constants: {
            MediaType: { VIDEO: 1, AUDIO: 2, ANY: 3 },
            ExportType: { IMMEDIATELY: 0 },
            TrackItemType: { CLIP: 1 },
        },
        _projectInstance: project,
    };
}

module.exports = {
    createMockApp,
    MockTickTime,
    MockSequence,
    TICKS_PER_SECOND,
};

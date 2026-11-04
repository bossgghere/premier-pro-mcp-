
const fs = require("uxp").storage.localFileSystem;
const app = require("premierepro");
const constants = require("premierepro").Constants;

const {BLEND_MODES, TRACK_TYPE } = require("./consts.js")

const {
    _getSequenceFromId,
    _setActiveSequence,
    setParam,
    getParam,
    addEffect,
    findProjectItem,
    execute,
    getTrack,
    getTrackItems,
    getClipName,
    getClipStartTicks,
    getClipEndTicks,
    validateClip,
} = require("./utils.js")

const saveProject = async (command) => {
    let project = await app.Project.getActiveProject()

    project.save()
}

const saveProjectAs = async (command) => {
    let project = await app.Project.getActiveProject()

    const options = command.options;
    const filePath = options.filePath;

    project.saveAs(filePath)
}

const openProject = async (command) => {

    const options = command.options;
    const filePath = options.filePath;

    await app.Project.open(filePath);    
}


const importMedia = async (command) => {

    let options = command.options
    let paths = command.options.filePaths

    let project = await app.Project.getActiveProject()

    let root = await project.getRootItem()
    let originalItems = await root.getItems()

    //import everything into root
    let rootFolderItems = await project.getRootItem()


    let success = await project.importFiles(paths, true, rootFolderItems)
    //TODO: what is not success?

    let updatedItems = await root.getItems()
    
    const addedItems = updatedItems.filter(
        updatedItem => !originalItems.some(originalItem => originalItem.name === updatedItem.name)
      );
      
    let addedProjectItems = [];
    for (const p of addedItems) { 
        addedProjectItems.push({ name: p.name });
    }
    
    return { addedProjectItems };
}


//note: right now, we just always add to the active sequence. Need to add support
//for specifying sequence
const addMediaToSequence = async (command) => {

    let options = command.options
    let itemName = options.itemName
    let id = options.sequenceId

    let project = await app.Project.getActiveProject()
    let sequence = await _getSequenceFromId(id)

    let insertItem = await findProjectItem(itemName, project)

    let editor = await app.SequenceEditor.getEditor(sequence)
  
    const insertionTime = await app.TickTime.createWithTicks(options.insertionTimeTicks.toString());
    const videoTrackIndex = options.videoTrackIndex
    const audioTrackIndex = options.audioTrackIndex
  
    //not sure what this does
    const limitShift = false

    //let f = ((options.overwrite) ? editor.createOverwriteItemAction : editor.createInsertProjectItemAction).bind(editor)
    //let action = f(insertItem, insertionTime, videoTrackIndex, audioTrackIndex, limitShift)
    execute(() => {
        let action = editor.createOverwriteItemAction(insertItem, insertionTime, videoTrackIndex, audioTrackIndex)
        return [action]
    }, project)  
}


const setAudioTrackMute = async (command) => {

    let options = command.options
    let id = options.sequenceId

    let sequence = await _getSequenceFromId(id)

    let track = await sequence.getTrack(options.audioTrackIndex, TRACK_TYPE.AUDIO)
    track.setMute(options.mute)
}



const setVideoClipProperties = async (command) => {

    const options = command.options
    let id = options.sequenceId

    let project = await app.Project.getActiveProject()
    let sequence = await _getSequenceFromId(id)

    if(!sequence) {
        throw new Error(`setVideoClipProperties : Requires an active sequence.`)
    }

    let trackItem = await getTrack(sequence, options.videoTrackIndex, options.trackItemIndex, TRACK_TYPE.VIDEO)

    let opacityParam = await getParam(trackItem, "AE.ADBE Opacity", "Opacity")
    let opacityKeyframe = await opacityParam.createKeyframe(options.opacity)

    let blendModeParam = await getParam(trackItem, "AE.ADBE Opacity", "Blend Mode")

    let mode = BLEND_MODES[options.blendMode.toUpperCase()]
    let blendModeKeyframe = await blendModeParam.createKeyframe(mode)

    execute(() => {
        let opacityAction = opacityParam.createSetValueAction(opacityKeyframe);
        let blendModeAction = blendModeParam.createSetValueAction(blendModeKeyframe);
        return [opacityAction, blendModeAction]
    }, project)

    // /AE.ADBE Opacity
    //Opacity
    //Blend Mode

}

const appendVideoFilter = async (command) => {

    let options = command.options
    let id = options.sequenceId

    let sequence = await _getSequenceFromId(id)

    if(!sequence) {
        throw new Error(`appendVideoFilter : Requires an active sequence.`)
    }

    let trackItem = await getTrackTrack(sequence, options.videoTrackIndex, options.trackItemIndex, TRACK_TYPE.VIDEO)

    let effectName = options.effectName
    let properties = options.properties

    let d = await addEffect(trackItem, effectName)

    for(const p of properties) {
        console.log(p.value)
        await setParam(trackItem, effectName, p.name, p.value)
    }
}


const setActiveSequence = async (command) => {
    let options = command.options
    let id = options.sequenceId

    let sequence = await _getSequenceFromId(id)

    await _setActiveSequence(sequence)
}

const createProject = async (command) => {

    let options = command.options
    let path = options.path
    let name = options.name

    if (!path.endsWith('/')) {
        path = path + '/';
    }

    //todo: this will open a dialog if directory doesnt exist
    let project = await app.Project.createProject(`${path}${name}.prproj`) 


    if(!project) {
        throw new Error("createProject : Could not create project. Check that the directory path exists and try again.")
    }

    //create a default sequence and set it as active
    //let sequence = await project.createSequence("default")
    //await project.setActiveSequence(sequence)
}


const _exportFrame = async (sequence, filePath, seconds) => {

    const fileType = filePath.split('.').pop()

    let size = await sequence.getFrameSize()

    let p = window.path.parse(filePath)
    let t = app.TickTime.createWithSeconds(seconds)

    let out = await app.Exporter.exportSequenceFrame(sequence, t, p.base, p.dir, size.width, size.height)

    let ps = `${p.dir}${window.path.sep}${p.base}`
    let outPath = `${ps}.${fileType}`

    if(!out) {
        throw new Error(`exportFrame : Could not save frame to [${outPath}]`);
    }

    return outPath
}

const exportFrame = async (command) => {
    const options = command.options;
    let id = options.sequenceId;
    let filePath = options.filePath;
    let seconds = options.seconds;

    let sequence = await _getSequenceFromId(id);

    const outPath = await _exportFrame(sequence, filePath, seconds);

    return {"filePath": outPath}
}

const setClipDisabled = async (command) => {

    const options = command.options;
    const id = options.sequenceId;
    const trackIndex = options.trackIndex;
    const trackItemIndex = options.trackItemIndex;
    const trackType = options.trackType;
    const expectedClipName = options.expectedClipName;
    const expectedStartTicks = options.expectedStartTicks;
    const dryRun = Boolean(options.dryRun);

    let project = await app.Project.getActiveProject()
    let sequence = await _getSequenceFromId(id)

    if(!sequence) {
        throw new Error(`setClipDisabled : Requires an active sequence.`)
    }

    let trackItem = await getTrack(sequence, trackIndex, trackItemIndex, trackType)

    const { actualName, actualStartTicks } = await validateClip(
        trackItem,
        expectedClipName,
        expectedStartTicks,
        trackIndex,
        trackItemIndex
    );

    if (dryRun) {
        return {
            dryRun: true,
            status: "VALIDATED",
            message: `Dry run: clip '${actualName}' validated. Disabled state would be set to ${options.disabled}.`,
            clipName: actualName,
            currentStartTicks: actualStartTicks,
            disabled: options.disabled,
        };
    }

    execute(() => {
        let action = trackItem.createSetDisabledAction(options.disabled)
        return [action]
    }, project)

    return {
        dryRun: false,
        status: "SUCCESS",
        message: `Successfully set clip '${actualName}' disabled to ${options.disabled}.`,
        clipName: actualName,
        disabled: options.disabled,
    };
}


const appendVideoTransition = async (command) => {

    let options = command.options
    let id = options.sequenceId

    let project = await app.Project.getActiveProject()
    let sequence = await _getSequenceFromId(id)

    if(!sequence) {
        throw new Error(`appendVideoTransition : Requires an active sequence.`)
    }

    let trackItem = await getTrack(sequence, options.videoTrackIndex, options.trackItemIndex,TRACK_TYPE.VIDEO)

    let transition = await app.TransitionFactory.createVideoTransition(options.transitionName);

    let transitionOptions = new app.AddTransitionOptions()
    transitionOptions.setApplyToStart(false)

    const time = await app.TickTime.createWithSeconds(options.duration)
    transitionOptions.setDuration(time)
    transitionOptions.setTransitionAlignment(options.clipAlignment)

    execute(() => {
        let action = trackItem.createAddVideoTransitionAction(transition, transitionOptions)
        return [action]
    }, project)
}


const getProjectInfo = async (command) => {
    return {}
}



const createSequenceFromMedia = async (command) => {

    let options = command.options

    let itemNames = options.itemNames
    let sequenceName = options.sequenceName

    let project = await app.Project.getActiveProject()

    let found = false
    try {
        await findProjectItem(sequenceName, project)
        found  = true
    } catch {
        //do nothing
    }

    if(found) {
        throw Error(`createSequenceFromMedia : sequence name [${sequenceName}] is already in use`)
    }

    let items = []
    for (const name of itemNames) {

        //this is a little inefficient
        let insertItem = await findProjectItem(name, project)
        items.push(insertItem)
    }


    let root = await project.getRootItem()
    
    let sequence = await project.createSequenceFromMedia(sequenceName, items, root)

    await _setActiveSequence(sequence)
}

const setClipStartEndTimes = async (command) => {
    const options = command.options;

    const sequenceId = options.sequenceId;
    const trackIndex = options.trackIndex;
    const trackItemIndex = options.trackItemIndex;
    const startTimeTicks = options.startTimeTicks;
    const endTimeTicks = options.endTimeTicks;
    const trackType = options.trackType;
    const expectedClipName = options.expectedClipName;
    const expectedStartTicks = options.expectedStartTicks;
    const dryRun = Boolean(options.dryRun);

    const sequence = await _getSequenceFromId(sequenceId)
    let trackItem = await getTrack(sequence, trackIndex, trackItemIndex, trackType)

    const { actualName, actualStartTicks } = await validateClip(
        trackItem,
        expectedClipName,
        expectedStartTicks,
        trackIndex,
        trackItemIndex
    );

    if (dryRun) {
        return {
            dryRun: true,
            status: "VALIDATED",
            message: `Dry run: clip '${actualName}' validated. Boundaries would be set to start: ${startTimeTicks}, end: ${endTimeTicks}.`,
            clipName: actualName,
            currentStartTicks: actualStartTicks,
            newStartTicks: startTimeTicks.toString(),
            newEndTicks: endTimeTicks.toString(),
        };
    }

    const startTick = await app.TickTime.createWithTicks(startTimeTicks.toString());
    const endTick = await app.TickTime.createWithTicks(endTimeTicks.toString());

    let project = await app.Project.getActiveProject();

    execute(() => {

        let out = []

        out.push(trackItem.createSetStartAction(startTick));
        out.push(trackItem.createSetEndAction(endTick))

        return out
    }, project)

    return {
        dryRun: false,
        status: "SUCCESS",
        message: `Successfully adjusted clip '${actualName}' boundaries.`,
        clipName: actualName,
        newStartTicks: startTimeTicks.toString(),
        newEndTicks: endTimeTicks.toString(),
    };
}

const closeGapsOnSequence = async(command) => {
    const options = command.options
    const sequenceId = options.sequenceId;
    const trackIndex = options.trackIndex;
    const trackType = options.trackType;

    let sequence = await _getSequenceFromId(sequenceId)

    let out = await _closeGapsOnSequence(sequence, trackIndex, trackType)
    
    return out
}

const _closeGapsOnSequence = async (sequence, trackIndex, trackType) => {
  
    let project = await app.Project.getActiveProject()

    let items = await getTrackItems(sequence, trackIndex, trackType)

    if(!items || items.length === 0) {
        return;
    }
    
    const f = async (item, targetPosition) => {
        let currentStart = await item.getStartTime()

        let a = await currentStart.ticksNumber
        let b = await targetPosition.ticksNumber
        let shiftAmount = (a - b)// How much to shift 
        
        shiftAmount *= -1;

        let shiftTick = app.TickTime.createWithTicks(shiftAmount.toString())

        return shiftTick
    }

    let targetPosition = app.TickTime.createWithTicks("0")


    for(let i = 0; i < items.length; i++) {
        let item = items[i];
        let shiftTick = await f(item, targetPosition)
        
        execute(() => {
            let out = []

                out.push(item.createMoveAction(shiftTick))

            return out
        }, project)
        
        targetPosition = await item.getEndTime()
    }
}

//TODO: change API to take trackType?

//TODO: pass in scope here
const removeItemFromSequence = async (command) => {
    const options = command.options;

    const sequenceId = options.sequenceId;
    const trackIndex = options.trackIndex;
    const trackItemIndex = options.trackItemIndex;
    const rippleDelete = options.rippleDelete;
    const trackType = options.trackType;
    const expectedClipName = options.expectedClipName;
    const expectedStartTicks = options.expectedStartTicks;
    const dryRun = Boolean(options.dryRun);

    let project = await app.Project.getActiveProject()
    let sequence = await _getSequenceFromId(sequenceId)

    if(!sequence) {
        throw Error(`removeItemFromSequence : sequence with id [${sequenceId}] not found.`)
    }

    let item = await getTrack(sequence, trackIndex, trackItemIndex, trackType);

    const { actualName, actualStartTicks } = await validateClip(
        item,
        expectedClipName,
        expectedStartTicks,
        trackIndex,
        trackItemIndex
    );

    if (dryRun) {
        return {
            dryRun: true,
            status: "VALIDATED",
            message: `Dry run: clip '${actualName}' validated. It would be removed (rippleDelete: ${rippleDelete}).`,
            clipName: actualName,
            currentStartTicks: actualStartTicks,
            rippleDelete,
        };
    }

    let editor = await app.SequenceEditor.getEditor(sequence)

    let trackItemSelection = await sequence.getSelection();
    let items = await trackItemSelection.getTrackItems()

    for (let t of items) {
        await trackItemSelection.removeItem(t)
    }

    trackItemSelection.addItem(item, true)

    execute(() => {
        const shiftOverlapping = false
        let action = editor.createRemoveItemsAction(trackItemSelection, rippleDelete, constants.MediaType.ANY, shiftOverlapping )
        return [action]
    }, project)

    return {
        dryRun: false,
        status: "SUCCESS",
        message: `Successfully removed clip '${actualName}'.`,
        clipName: actualName,
        rippleDelete,
    };
}

const addMarkerToSequence = async (command) => {
    const options = command.options;
    const sequenceId = options.sequenceId;
    const markerName = options.markerName;
    const startTimeTicks = options.startTimeTicks;
    const durationTicks = options.durationTicks;
    const comments = options.comments;

    const sequence = await _getSequenceFromId(sequenceId)

    if(!sequence) {
        throw Error(`addMarkerToSequence : sequence with id [${sequenceId}] not found.`)
    }

    let markers = await app.Markers.getMarkers(sequence);

    let project = await app.Project.getActiveProject()

    execute(() => {

        let start = app.TickTime.createWithTicks(startTimeTicks.toString())
        let duration = app.TickTime.createWithTicks(durationTicks.toString())

        let action = markers.createAddMarkerAction(markerName, "WebLink",  start, duration, comments)
        return [action]
    }, project)

}

const moveProjectItemsToBin = async (command) => {
    const options = command.options;
    const binName = options.binName;
    const projectItemNames = options.itemNames;

    const project = await app.Project.getActiveProject()
    
    const binFolderItem = await findProjectItem(binName, project)

    if(!binFolderItem) {
        throw Error(`moveProjectItemsToBin : Bin with name [${binName}] not found.`)
    }

    let folderItems = [];

    for(let name of projectItemNames) {
        let item = await findProjectItem(name, project)

        if(!item) {
            throw Error(`moveProjectItemsToBin : FolderItem with name [${name}] not found.`)
        }

        folderItems.push(item)
    }

    const rootFolderItem = await project.getRootItem()

    execute(() => {

        let actions = []

        for(let folderItem of folderItems) {
            let b = app.FolderItem.cast(binFolderItem)
            let action = rootFolderItem.createMoveItemAction(folderItem, b)
            actions.push(action)
        }

        return actions
    }, project)

}

const createBinInActiveProject = async (command) => {
    const options = command.options;
    const binName = options.binName;

    const project = await app.Project.getActiveProject()
    const folderItem = await project.getRootItem()

    execute(() => {
        let action = folderItem.createBinAction(binName, true)
        return [action]
    }, project)
}

const exportSequence = async (command) => {
    const options = command.options;
    const sequenceId = options.sequenceId;
    const outputPath = options.outputPath;
    const presetPath = options.presetPath;

    const manager = await app.EncoderManager.getManager();

    const sequence = await _getSequenceFromId(sequenceId);

    await manager.exportSequence(sequence, constants.ExportType.IMMEDIATELY, outputPath, presetPath);
}

const moveClip = async (command) => {
    const options = command.options;
    const sequenceId = options.sequenceId;
    const trackType = options.trackType;
    const trackIndex = options.trackIndex;
    const clipIndex = options.clipIndex;
    const newStartTicks = options.newStartTicks;
    const expectedClipName = options.expectedClipName;
    const expectedStartTicks = options.expectedStartTicks;
    const dryRun = Boolean(options.dryRun);

    const sequence = await _getSequenceFromId(sequenceId);
    if (!sequence) {
        throw new Error(`moveClip : sequence with id [${sequenceId}] not found.`);
    }

    const trackItem = await getTrack(sequence, trackIndex, clipIndex, trackType);
    const { actualName, actualStartTicks } = await validateClip(
        trackItem,
        expectedClipName,
        expectedStartTicks,
        trackIndex,
        clipIndex
    );

    const shiftAmount = BigInt(newStartTicks.toString()) - BigInt(actualStartTicks);
    const shiftTick = app.TickTime.createWithTicks(shiftAmount.toString());

    if (dryRun) {
        return {
            dryRun: true,
            status: "VALIDATED",
            message: `Dry run: clip '${actualName}' on ${trackType} track ${trackIndex} (current start: ${actualStartTicks} ticks) would be moved to ${newStartTicks} ticks (delta: ${shiftAmount.toString()} ticks).`,
            clipName: actualName,
            currentStartTicks: actualStartTicks,
            newStartTicks: newStartTicks.toString(),
            shiftAmountTicks: shiftAmount.toString(),
        };
    }

    const project = await app.Project.getActiveProject();
    execute(() => {
        const action = trackItem.createMoveAction(shiftTick);
        return [action];
    }, project);

    return {
        dryRun: false,
        status: "SUCCESS",
        message: `Successfully moved clip '${actualName}' to ${newStartTicks} ticks.`,
        clipName: actualName,
        previousStartTicks: actualStartTicks,
        newStartTicks: newStartTicks.toString(),
        shiftAmountTicks: shiftAmount.toString(),
    };
};

const getMarkers = async (command) => {
    const options = command.options;
    const sequenceId = options.sequenceId;

    const sequence = await _getSequenceFromId(sequenceId);
    if (!sequence) {
        throw new Error(`getMarkers : sequence with id [${sequenceId}] not found.`);
    }

    const markersManager = await app.Markers.getMarkers(sequence);
    const markerList = markersManager ? markersManager.getMarkers() : [];

    const result = [];
    for (const m of markerList) {
        const start = await m.getStart();
        const duration = await m.getDuration();
        const name = typeof m.getName === "function" ? await m.getName() : m.name;
        const comments = typeof m.getComments === "function" ? await m.getComments() : m.comments;
        const type = typeof m.getType === "function" ? await m.getType() : m.type;
        const guid = m.guid ? m.guid.toString() : (typeof m.getGuid === "function" ? (await m.getGuid()).toString() : undefined);
        const colorIndex = typeof m.getColorIndex === "function" ? await m.getColorIndex() : undefined;

        result.push({
            guid,
            name: name || "",
            comments: comments || "",
            type: type || "Comment",
            startTimeTicks: start && start.ticks !== undefined ? start.ticks.toString() : (start && start.ticksNumber !== undefined ? start.ticksNumber.toString() : "0"),
            startTimeSeconds: start && start.seconds !== undefined ? start.seconds : 0,
            durationTicks: duration && duration.ticks !== undefined ? duration.ticks.toString() : (duration && duration.ticksNumber !== undefined ? duration.ticksNumber.toString() : "0"),
            durationSeconds: duration && duration.seconds !== undefined ? duration.seconds : 0,
            colorIndex,
        });
    }

    return {
        sequenceId,
        count: result.length,
        markers: result,
    };
};

const razorAtTime = async (command) => {
    const options = command.options;
    const sequenceId = options.sequenceId;
    const timeTicks = options.timeTicks;
    const trackType = options.trackType || TRACK_TYPE.VIDEO;
    const trackIndex = options.trackIndex !== undefined && options.trackIndex !== null ? options.trackIndex : null;
    const expectedClipName = options.expectedClipName;
    const expectedStartTicks = options.expectedStartTicks;
    const dryRun = Boolean(options.dryRun);

    const sequence = await _getSequenceFromId(sequenceId);
    if (!sequence) {
        throw new Error(`razorAtTime : sequence with id [${sequenceId}] not found.`);
    }

    let tracksToCheck = [];
    if (trackIndex !== null) {
        tracksToCheck.push(trackIndex);
    } else {
        const count = trackType === TRACK_TYPE.AUDIO
            ? await sequence.getAudioTrackCount()
            : await sequence.getVideoTrackCount();
        for (let i = 0; i < count; i++) {
            tracksToCheck.push(i);
        }
    }

    const cutTimeBigInt = BigInt(timeTicks.toString());
    const foundClips = [];

    for (const tIndex of tracksToCheck) {
        const items = await getTrackItems(sequence, tIndex, trackType);
        let clipIndex = 0;
        for (const item of items) {
            const startTicks = BigInt(await getClipStartTicks(item));
            const endTicks = BigInt(await getClipEndTicks(item));
            if (cutTimeBigInt >= startTicks && cutTimeBigInt <= endTicks) {
                const clipName = await getClipName(item);
                foundClips.push({
                    trackIndex: tIndex,
                    clipIndex,
                    trackItem: item,
                    clipName,
                    startTicks: startTicks.toString(),
                    endTicks: endTicks.toString(),
                });
            }
            clipIndex++;
        }
    }

    if (foundClips.length === 0) {
        throw new Error(
            `razorAtTime : No clip found on trackType [${trackType}] at time ${timeTicks} ticks.`
        );
    }

    if (!expectedClipName) {
        throw new Error("Refusing edit: 'expected_clip_name' is required to guard against timeline desynchronization.");
    }
    if (expectedStartTicks === undefined || expectedStartTicks === null || expectedStartTicks === "") {
        throw new Error("Refusing edit: 'expected_start_ticks' is required to guard against timeline desynchronization.");
    }

    for (const match of foundClips) {
        if (match.clipName !== expectedClipName) {
            throw new Error(
                `Refusing edit: Clip name mismatch on track ${match.trackIndex}, clip ${match.clipIndex}. Expected '${expectedClipName}', but found '${match.clipName}'. Timeline may have shifted.`
            );
        }
        if (BigInt(match.startTicks) !== BigInt(expectedStartTicks.toString())) {
            throw new Error(
                `Refusing edit: Clip start time mismatch on track ${match.trackIndex}, clip ${match.clipIndex}. Expected ${expectedStartTicks} ticks, but found ${match.startTicks} ticks. Timeline may have shifted.`
            );
        }
    }

    if (dryRun) {
        return {
            dryRun: true,
            status: "VALIDATED",
            message: `Dry run: Found ${foundClips.length} matching clip(s) for razor at ${timeTicks} ticks. Official Premiere Pro UXP API does not provide a native razor/split method; razor cuts are performed via the Premiere CEP companion panel (cep/com.mikechambers.pr) using the QE DOM.`,
            targetClips: foundClips.map((c) => ({
                trackIndex: c.trackIndex,
                clipIndex: c.clipIndex,
                clipName: c.clipName,
                startTicks: c.startTicks,
                endTicks: c.endTicks,
            })),
            cepPanel: "cep/com.mikechambers.pr",
        };
    }

    throw new Error(
        `razor_at_time requires the Premiere Pro CEP companion panel (cep/com.mikechambers.pr) to execute live timeline cuts via the QE DOM. The official Premiere Pro UXP DOM API does not expose a razor/split method. Please open 'Window > Extensions > Premiere Pro MCP CEP Agent' in Premiere Pro and click 'Connect' to enable QE razor cutting.`
    );
};

const applyEdits = async (command) => {
    const options = command.options;
    const edits = options.edits || [];
    const dryRun = Boolean(options.dryRun);

    if (!Array.isArray(edits) || edits.length === 0) {
        return {
            status: "SUCCESS",
            message: "No edits provided to apply.",
            appliedCount: 0,
        };
    }

    const project = await app.Project.getActiveProject();

    const getEditTimeBigInt = (edit) => {
        if (edit.expectedStartTicks !== undefined && edit.expectedStartTicks !== null) {
            return BigInt(edit.expectedStartTicks.toString());
        }
        if (edit.expected_start_ticks !== undefined && edit.expected_start_ticks !== null) {
            return BigInt(edit.expected_start_ticks.toString());
        }
        if (edit.startTimeTicks !== undefined && edit.startTimeTicks !== null) {
            return BigInt(edit.startTimeTicks.toString());
        }
        if (edit.start_time_ticks !== undefined && edit.start_time_ticks !== null) {
            return BigInt(edit.start_time_ticks.toString());
        }
        if (edit.newStartTicks !== undefined && edit.newStartTicks !== null) {
            return BigInt(edit.newStartTicks.toString());
        }
        if (edit.new_start_ticks !== undefined && edit.new_start_ticks !== null) {
            return BigInt(edit.new_start_ticks.toString());
        }
        if (edit.timeTicks !== undefined && edit.timeTicks !== null) {
            return BigInt(edit.timeTicks.toString());
        }
        if (edit.time_ticks !== undefined && edit.time_ticks !== null) {
            return BigInt(edit.time_ticks.toString());
        }
        return 0n;
    };

    const sortedEdits = [...edits].sort((a, b) => {
        const timeA = getEditTimeBigInt(a);
        const timeB = getEditTimeBigInt(b);
        if (timeB > timeA) return 1;
        if (timeB < timeA) return -1;
        return 0;
    });

    const preparedEdits = [];
    for (let i = 0; i < sortedEdits.length; i++) {
        const edit = sortedEdits[i];
        const editType = (edit.type || edit.action || "").toLowerCase();
        const sequenceId = edit.sequenceId || edit.sequence_id;
        const trackType = edit.trackType || edit.track_type || TRACK_TYPE.VIDEO;
        const trackIndex = edit.trackIndex !== undefined ? edit.trackIndex : edit.track_index;
        const clipIndex = edit.clipIndex !== undefined ? edit.clipIndex : edit.clip_index;
        const expectedClipName = edit.expectedClipName !== undefined ? edit.expectedClipName : edit.expected_clip_name;
        const expectedStartTicks = edit.expectedStartTicks !== undefined ? edit.expectedStartTicks : edit.expected_start_ticks;

        const sequence = await _getSequenceFromId(sequenceId);
        if (!sequence) {
            throw new Error(`applyEdits : Sequence with id [${sequenceId}] not found for edit at index ${i}.`);
        }

        let trackItem = null;
        let actualName = null;
        let actualStartTicks = null;

        if (trackIndex !== undefined && clipIndex !== undefined) {
            trackItem = await getTrack(sequence, trackIndex, clipIndex, trackType);
            const validated = await validateClip(trackItem, expectedClipName, expectedStartTicks, trackIndex, clipIndex);
            actualName = validated.actualName;
            actualStartTicks = validated.actualStartTicks;
        }

        preparedEdits.push({
            originalEdit: edit,
            editType,
            sequence,
            trackItem,
            actualName,
            actualStartTicks,
            trackType,
            trackIndex,
            clipIndex,
            timeTicks: getEditTimeBigInt(edit).toString(),
        });
    }

    if (dryRun) {
        return {
            dryRun: true,
            status: "VALIDATED",
            message: `Dry run successful: All ${preparedEdits.length} edits validated against timeline and ordered from latest to earliest.`,
            executionPlan: preparedEdits.map((p, idx) => ({
                executionOrder: idx + 1,
                editType: p.editType,
                trackIndex: p.trackIndex,
                clipIndex: p.clipIndex,
                clipName: p.actualName,
                scheduledTimeTicks: p.timeTicks,
                details: p.originalEdit,
            })),
        };
    }

    execute(() => {
        const actions = [];
        for (const prepared of preparedEdits) {
            const edit = prepared.originalEdit;
            const editType = prepared.editType;
            const item = prepared.trackItem;

            if (editType === "move_clip" || editType === "moveclip") {
                const newStartTicks = edit.newStartTicks !== undefined ? edit.newStartTicks : edit.new_start_ticks;
                const shiftAmount = BigInt(newStartTicks.toString()) - BigInt(prepared.actualStartTicks);
                const shiftTick = app.TickTime.createWithTicks(shiftAmount.toString());
                actions.push(item.createMoveAction(shiftTick));
            } else if (editType === "set_clip_start_end_times" || editType === "setclipstartendtimes") {
                const startTimeTicks = edit.startTimeTicks !== undefined ? edit.startTimeTicks : edit.start_time_ticks;
                const endTimeTicks = edit.endTimeTicks !== undefined ? edit.endTimeTicks : edit.end_time_ticks;
                const startTick = app.TickTime.createWithTicks(startTimeTicks.toString());
                const endTick = app.TickTime.createWithTicks(endTimeTicks.toString());
                actions.push(item.createSetStartAction(startTick));
                actions.push(item.createSetEndAction(endTick));
            } else if (editType === "set_clip_disabled" || editType === "setclipdisabled") {
                const disabled = edit.disabled !== undefined ? edit.disabled : true;
                actions.push(item.createSetDisabledAction(disabled));
            } else {
                throw new Error(`applyEdits : Unsupported edit type '${editType}' in batch edits.`);
            }
        }
        return actions;
    }, project);

    return {
        dryRun: false,
        status: "SUCCESS",
        message: `Successfully applied ${preparedEdits.length} edits from latest to earliest in a single undo transaction.`,
        appliedEditsCount: preparedEdits.length,
    };
};

const commandHandlers = {
    moveClip,
    getMarkers,
    razorAtTime,
    applyEdits,
    exportSequence,
    moveProjectItemsToBin,
    createBinInActiveProject,
    addMarkerToSequence,
    closeGapsOnSequence,
    removeItemFromSequence,
    setClipStartEndTimes,
    openProject,
    saveProjectAs,
    saveProject,
    getProjectInfo,
    setActiveSequence,
    exportFrame,
    setVideoClipProperties,
    createSequenceFromMedia,
    setAudioTrackMute,
    setClipDisabled,
    appendVideoTransition,
    appendVideoFilter,
    addMediaToSequence,
    importMedia,
    createProject,
};

module.exports = {
    commandHandlers
}
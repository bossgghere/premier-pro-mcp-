/* main.js
 * Premiere Pro CEP MCP Agent Panel
 * Bridges Socket.IO command proxy to ExtendScript / QE DOM
 */

const APPLICATION = "premiere_cep";
const PROXY_URL = "http://localhost:3001";

let socket = null;

function log(message) {
    const logArea = document.getElementById("messageLog");
    if (!logArea) return;
    const timestamp = new Date().toLocaleTimeString();
    logArea.value += `[${timestamp}] ${message}\n`;
    logArea.scrollTop = logArea.scrollHeight;
}

function updateStatus(connected) {
    const statusDot = document.getElementById("statusDot");
    const statusText = document.getElementById("statusText");
    const btnConnect = document.getElementById("btnConnect");

    if (!statusDot || !statusText || !btnConnect) return;

    if (connected) {
        statusDot.classList.add("connected");
        statusText.textContent = "Connected (QE Razor Ready)";
        btnConnect.textContent = "Disconnect";
    } else {
        statusDot.classList.remove("connected");
        statusText.textContent = "Disconnected";
        btnConnect.textContent = "Connect";
    }
}

async function onCommandPacket(packet) {
    const command = packet.command;
    log(`Received CEP command: ${command.action}`);

    const out = {
        senderId: packet.senderId,
    };

    try {
        const response = await parseAndRouteCommand(command);
        out.response = response;
        out.status = "SUCCESS";
        log(`✓ Command ${command.action} completed successfully.`);
    } catch (e) {
        out.status = "FAILURE";
        out.message = `Error in Premiere CEP (${command.action}): ${e.message || e}`;
        log(`✗ Error: ${out.message}`);
    }

    return out;
}

function connectToServer() {
    log(`Connecting to proxy at ${PROXY_URL}...`);

    socket = io(PROXY_URL, {
        transports: ["websocket", "polling"],
    });

    socket.on("connect", () => {
        updateStatus(true);
        log(`Connected with socket ID: ${socket.id}`);
        socket.emit("register", { application: APPLICATION });
    });

    socket.on("command_packet", async (packet) => {
        const response = await onCommandPacket(packet);
        sendResponsePacket(response);
    });

    socket.on("registration_response", (data) => {
        log(`Registered as '${APPLICATION}': ${data.message || "OK"}`);
    });

    socket.on("connect_error", (err) => {
        updateStatus(false);
        log(`Connection error: ${err.message || err}`);
    });

    socket.on("disconnect", (reason) => {
        updateStatus(false);
        log(`Disconnected: ${reason}`);
    });
}

function disconnectFromServer() {
    if (socket && socket.connected) {
        socket.disconnect();
        updateStatus(false);
        log("Disconnected from server.");
    }
}

function sendResponsePacket(packet) {
    if (socket && socket.connected) {
        socket.emit("command_packet_response", { packet: packet });
        return true;
    }
    return false;
}

document.addEventListener("DOMContentLoaded", () => {
    const btnConnect = document.getElementById("btnConnect");
    const chkConnect = document.getElementById("chkConnectOnLaunch");

    if (btnConnect) {
        btnConnect.addEventListener("click", () => {
            if (socket && socket.connected) {
                disconnectFromServer();
            } else {
                connectToServer();
            }
        });
    }

    if (chkConnect && chkConnect.checked) {
        connectToServer();
    }
});

require("dotenv").config();
const {parseIncomingMessage, formatReceipt, prepareMediaMessage, delayMsg, } = require("../lib/helper");
const axios = require("axios");
const {isExistsEqualCommand, isExistsContainCommand, getUrlWebhook, getDevice, isFavoriteContact, getDeviceSettings, logNewMessage, getChatMessages, } = require("../database/model");
const {formatButtonMsg, Button} = require("../dto/button");
const {ulid} = require("ulid");
const {Section, formatListMsg} = require("../dto/list");
let deviceSettings = null;
const IncomingMessage = async (msg, sock) => {
    try {
        if (!msg.messages) return;
        msg = msg.messages[0];
        if (msg.key.fromMe === true) return;
        
        let quoted = false;
        const senderName = msg?.pushName || "";
        const numberWa = sock.user.id.split(":")[0];
        deviceSettings = await getDeviceSettings(numberWa);
        //Handle status
        if (msg.key.remoteJid === "status@broadcast" && (deviceSettings.auto_status_save === 'enabled' || deviceSettings.status_nudity_detection === 'enabled')) {
            const contactName = senderName;
            const contactNo = msg.key.participant.split("@")[0];
            const favoriteContactName = await isFavoriteContact(numberWa, contactNo);
            const localContact = contactNo.substr(0, 2) == "92" ? "0" + contactNo.substr(2) : contactNo;
            try {
                if (msg.message?.videoMessage) {
                    const statusUpdate = msg.message.videoMessage;
                    const stream = await downloadContentFromMessage(statusUpdate, "video");
                    let buffer = Buffer.from([]);
                    for await(const chunk of stream) {
                        buffer = Buffer.concat([buffer, chunk]);
                    }
                    //Save Status Video
                    if (favoriteContactName != false && deviceSettings.auto_status_save === 'enabled') {
                        await sock.sendMessage(numberWa + "@c.us", {
                            video: buffer,
                            caption: "Status Update from *" + favoriteContactName + "*."
                        }, {
                            quoted: msg
                        });
                    }
                    //check nudity in status video
                    if (deviceSettings.status_nudity_detection === 'enabled') {
                        const bufferVideo = buffer.toString("base64");
                        const nudityCheck = await checkNudity(numberWa, bufferVideo, "video").catch(e => console.error("Nudity check failed", e));
                        if (nudityCheck && nudityCheck.nude) {
                            await sock.sendMessage(msg.key.participant, {
                                text: "Hello, I noticed your WhatsApp status may contain content that's not suitable, such as explicit, or unsafe material. Please review it once more.\nThanks."
                            }, {
                                quoted: msg
                            });
                        }
                    }
                } else if (msg.message?.imageMessage) {
                    const statusUpdate = msg.message.imageMessage;
                    const stream = await downloadContentFromMessage(statusUpdate, "image");
                    let buffer = Buffer.from([]);
                    for await(const chunk of stream) {
                        buffer = Buffer.concat([buffer, chunk]);
                    }
                    //Save Status Image
                    if (favoriteContactName != false && deviceSettings.auto_status_save === 'enabled') {
                        await sock.sendMessage(numberWa + "@c.us", {
                            image: buffer,
                            caption: "Status Update from *" + favoriteContactName + "*."
                        }, {
                            quoted: msg
                        });
                    }
                    //check nudity in status image
                    if (deviceSettings.status_nudity_detection === 'enabled') {
                        const bufferImage = buffer.toString("base64");
                        const nudityCheck = await checkNudity(numberWa, bufferImage, "image").catch(e => console.error("Nudity check failed", e));
                        if (nudityCheck && nudityCheck.nude) {
                            await sock.sendMessage(msg.key.participant, {
                                text: "Hello, I noticed your WhatsApp status may contain content that's not suitable, such as explicit, or unsafe material. Please review it once more.n\nThanks."
                            }, {
                                quoted: msg
                            });
                        }
                    }
                }
            } catch (error) {
                console.error("Error sending status:", error);
                if (deviceSettings.auto_status_save === 'enabled') {
                    await sock.sendMessage(msg.key.remoteJid, {
                        text: "A New Status Update is posted from *" + favoriteContactName + "*."
                    }, {
                        quoted: msg
                    });
                }
            }
            return;
        }
        ;//Handle status
        const participant = msg.key.participant && formatReceipt(msg.key.participant);
        const {command, bufferImage, from} = await parseIncomingMessage(msg);

        const type = Object.keys(msg.message || {})[0];
        //check nudity in Image Received in Message.
        if (type === "imageMessage" && bufferImage != null && deviceSettings.chat_nudity_detection === 'enabled') {
            const nudityCheck = await checkNudity(numberWa, bufferImage, "image").catch(e => console.error("Nudity check failed", e));
            if (nudityCheck && nudityCheck.nude) {
                await sock.sendMessage(msg.key.remoteJid, {
                    text: "The image you sent contains nudity. If this was sent by mistake, please remove it."
                }, {
                    quoted: msg
                });
            }
        }//check nudity in Image Received  Message.

        // Transcribe Received  Message
        else if (type === "audioMessage" && bufferImage != null && deviceSettings.transcription_status === 'enabled') {
            const transcription = await transcribeAudio(Buffer.from(bufferImage, "base64")).catch(e => console.error("Transcription failed", e));
            if (transcription != false && transcription !== "") {
                const translated_text = await translateText(transcription);
                if (translated_text != false && translated_text !== "") {
                    await sock.sendMessage(msg.key.remoteJid, {
                        text: "*Audio Transcription/Translation*\n" + (translated_text)
                    }, {
                        quoted: msg
                    });
                } else {
                    await sock.sendMessage(msg.key.remoteJid, {
                        text: "*Audio Transcription*\n" + (transcription)
                    }, {
                        quoted: msg
                    });
                }

            }
            return false;
        }
        // Transcribe Received  Message.
        //handle auto status send
        if (type === "extendedTextMessage" && deviceSettings.auto_status_forward === 'enabled' && command.toLowerCase().search("send") > -1) {
            try {
                if (msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.videoMessage) {
                    await sock.sendMessage(msg.key.remoteJid, {
                        text: "Sure, I am sending you this video.."
                    });
                    const quotedMessage = msg.message.extendedTextMessage.contextInfo.quotedMessage.videoMessage;
                    const stream = await downloadContentFromMessage(quotedMessage, "video");
                    let buffer = Buffer.from([]);
                    for await(const chunk of stream) {
                        buffer = Buffer.concat([buffer, chunk]);
                    }
                    await sock.sendMessage(msg.key.remoteJid, {
                        video: buffer
                    }, {
                        quoted: msg
                    });
                } else if (msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage) {
                    await sock.sendMessage(msg.key.remoteJid, {
                        text: "Sure, I am sending you this image.."
                    });
                    const quotedMessage = msg.message.extendedTextMessage.contextInfo.quotedMessage.imageMessage;
                    const stream = await downloadContentFromMessage(quotedMessage, "image");
                    let buffer = Buffer.from([]);
                    for await(const chunk of stream) {
                        buffer = Buffer.concat([buffer, chunk]);
                    }
                    await sock.sendMessage(msg.key.remoteJid, {
                        image: buffer
                    }, {
                        quoted: msg
                    });
                }
            } catch (error) {
                console.error("Error sending video:", error);
                await sock.sendMessage(msg.key.remoteJid, {
                    text: "Sorry, an error occurred while sending you. Please wait."
                });
            }
        }
        //handle auto status send

        let reply;
        let result;
        // check auto reply in database
        const checkEqual = await isExistsEqualCommand(command, numberWa);
        if (checkEqual.length > 0) {
            result = checkEqual;
        } else {
            result = await isExistsContainCommand(command, numberWa);
        }
        // end check autoreply in database

        if (result.length === 0) {
            if (deviceSettings.gemini_status === 'enabled' && command !== "") {
                let logStatus = await logNewMessage(numberWa, from, command, 'user');
                if (logStatus) {
                    const ai_reply = await getAIReply(numberWa, from);
                    if (ai_reply != false && getAIReply !== "") {
                        logStatus = await logNewMessage(numberWa, from, ai_reply, 'model');
                        if (logStatus) {
                            await sock.sendMessage(msg.key.remoteJid, {
                                text: "*Assistant*\n" + (ai_reply)
                            }, {
                                quoted: msg
                            });
                        }
                    }
                }
            }
            const device = await getDevice(numberWa);

            const url = await getUrlWebhook(numberWa);

            if (url == null)
                return;
            const r = await sendWebhook({
                device: numberWa,
                command: command,
                bufferImage,
                from,
                name: senderName,
                url,
                participant,
            });
            if (r === false)
                return;
            if (r === undefined)
                return;
            if (typeof r != "object")
                return;
            quoted = r?.quoted ? true : false;
            if (device.length > 0) {
                if (device[0].wh_read == 1) {
                    sock.readMessages([msg.key]);
                }

                if (device[0].wh_typing == 1) {
                    const delay = 2 * 1000;
                    await delayMsg(delay, sock, msg.key.remoteJid);
                }
            }

            reply = JSON.stringify(r);
        } else {
            replyorno = result[0].reply_when == "All" ? true : result[0].reply_when == "Group" && msg.key.remoteJid.includes("@g.us") ? true : result[0].reply_when == "Personal" && !msg.key.remoteJid.includes("@g.us") ? true : false;

            if (replyorno === false)
                return;

            if (result[0].is_read != 0) {
                sock.readMessages([msg.key]);
            }
            if (result[0].is_typing == 1) {
                const delay = result[0].delay == 0 ? 2000 : result[0].delay * 1000;
                await delayMsg(delay, sock, msg.key.remoteJid);
            }
            quoted = result[0].is_quoted ? true : false;
            if (typeof result[0].reply === "object") {
                reply = JSON.stringify(result[0].reply);
            } else {
                reply = result[0].reply;
            }
        }
        reply = reply.replace(/{name}/g, senderName);
        // replace if exists {name} with sender name in reply
        reply = JSON.parse(reply);

        //typing

        // send MEDIA MESSAGE

        if ("type"in reply) {
            let ownerJid = sock.user.id.replace(/:\d+/, "");
            //audio
            if (reply.type == "audio") {
                return await sock.sendMessage(msg.key.remoteJid, {
                    audio: {
                        url: reply.url
                    },
                    ptt: true,
                    mimetype: "audio/mpeg",
                });
            }
            //button

            // for send media ( document/video or image)
            const generate = await prepareMediaMessage(sock, {
                caption: reply.caption ? reply.caption : "",
                fileName: reply.filename,
                media: reply.url,
                mediatype: reply.type !== "video" && reply.type !== "image" ? "document" : reply.type,
            });

            const message = {
                ...generate.message
            };

            return await sock.sendMessage(msg.key.remoteJid, {
                forward: {
                    key: {
                        remoteJid: ownerJid,
                        fromMe: true
                    },
                    message: message,
                },
            }, {
                quoted: quoted ? msg : null,
            });
            //SEND TEXT MESSAGE
        } else if ("buttons"in reply) {
            const btns = reply.buttons.map( (btn) => new Button(btn));
            const message = formatButtonMsg(btns, reply?.footer, reply.text ?? reply?.caption, sock, reply?.image?.url);
            const msgId = ulid(Date.now());
            return await sock.relayMessage(msg.key.remoteJid, message, {
                messageId: msgId,
            });
        } else if ("sections"in reply) {
            const sections = reply.sections.map( (sect) => new Section(sect));
            const message = formatListMsg(sections, reply?.footer ?? "..", reply.text ?? reply.caption, sock, reply?.image?.url);
            const msgId = ulid(Date.now());
            return await sock.relayMessage(msg.key.remoteJid, message, {
                messageId: msgId,
            });
        } else {
            await sock.sendMessage(msg.key.remoteJid, reply, {
                quoted: quoted ? msg : null,
            }).catch( (e) => {
                console.log(e);
            }
            );
        }
        return true;
    } catch (e) {
        console.log(e);
    }
}
;

async function sendWebhook({device, command, bufferImage, from, name, url, participant, }) {
    try {
        const data = {
            device,
            message: command,
            bufferImage: bufferImage == undefined ? null : bufferImage,
            from,
            name,
            participant,
        };
        const headers = {
            "Content-Type": "application/json; charset=utf-8"
        };
        const res = await axios.post(url, data, headers).catch( () => {
            return false;
        }
        );
        return res.data;
    } catch (error) {
        console.log("error send webhook", error);
        return false;
    }
}

async function checkNudity(sock_id, base64Data, type='image') {
    try {
        const url = "https://nudenet.adikhanofficial.com";
        const params = new URLSearchParams();
        params.append(type, base64Data);
        params.append("sock_id", sock_id);
        const headers = {
            "Content-Type": "application/x-www-form-urlencoded"
        };
        const res = await axios.post(url, params, {
            headers
        }).catch( (error) => {
            console.error('Error sending request:', error);
            return false;
        }
        );
        if (res === false) {
            return false;
        }
        return res.data;
    } catch (error) {
        console.error('Error checking nudity:', error);
        return false;
    }
}

async function getAIReply(numberWa, number) {
    try {
        let messages = [];
        const chatHistory = await getChatMessages(numberWa, number);
        for (let i = 0; i < chatHistory.length; i++) {
            messages.push({
                role: chatHistory[i].role,
                parts: [{
                    text: chatHistory[i].message
                }]
            });
        }
        const payload = {
            contents: messages
        };
        const instruction = deviceSettings.gemini_instructions;
        if (instruction) {
            return await getGeminiResponse(payload, instruction.trim());
        }
    } catch (error) {
        console.error("Error in getAIReply:", error.message);
    }
    return false;
}

async function getGeminiResponse(payload, instruction="") {
    try {
        const gemini_status = deviceSettings.gemini_status;
        const gemini_model = deviceSettings.gemini_model ?? "gemini-1.5-flash";
        const gemini_api_key = deviceSettings.gemini_api_key;
        if (gemini_status === 'enabled' && gemini_api_key) {
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${gemini_model}:generateContent?key=${gemini_api_key}`;
            const headers = {
                "Content-Type": "application/json"
            };
            const geminiSettings = [{
                category: "HARM_CATEGORY_HARASSMENT",
                threshold: "BLOCK_NONE"
            }, {
                category: "HARM_CATEGORY_HATE_SPEECH",
                threshold: "BLOCK_NONE"
            }, {
                category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                threshold: "BLOCK_NONE"
            }, {
                category: "HARM_CATEGORY_DANGEROUS_CONTENT",
                threshold: "BLOCK_NONE"
            }, {
                category: "HARM_CATEGORY_CIVIC_INTEGRITY",
                threshold: "BLOCK_NONE"
            }];
            payload.safetySettings = geminiSettings;
            payload.system_instruction = {
                parts: [{
                    text: instruction
                }]
            };

            const response = await axios.post(apiUrl, payload, {
                headers
            });
            const candidates = response?.data?.candidates;
            if (candidates && candidates.length > 0) {
                const content = candidates[0]?.content?.parts;
                if (content && content.length > 0) {
                    return content[0].text;
                }
            }
        }
    } catch (error) {
        console.error("Error fetching Gemini response:", error.response?.data || error.message);
    }
    return false;
}

async function translateText(text) {
    const instruction = `
        Your role is to translate messages:
        - If the message is in Hindi, or Urdu translate it into Urdu.
        - If the message is in any other language, translate it into English.
        **Note**: Do not add any extra information other than the translated content.
    `;

    const payload = {
        contents: [{
            role: "user",
            parts: [{
                text: text
            }]
        }]
    };

    return await getGeminiResponse(payload, instruction.trim());
}

async function transcribeAudio(audioData) {
    const transcription_status = deviceSettings.transcription_status;
    const transcription_model = deviceSettings.transcription_model ?? "whisper-large-v3-turbo";
    const huggingface_api_key = deviceSettings.huggingface_api_key;
    if (transcription_status === "enabled" && huggingface_api_key !== "") {
        const apiUrl = "https://api-inference.huggingface.co/models/openai/" + transcription_model;
        const headers = {
            Authorization: `Bearer ${huggingface_api_key}`,
            "Content-Type": "application/octet-stream"
        };
        let responseData = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const response = await axios.post(apiUrl, audioData, {
                    headers
                });
                responseData = response.data;

                if (responseData.text) {
                    return responseData.text;
                    // Successful transcription
                }
            } catch (error) {
                console.error(`Attempt ${attempt} failed:`, error.message);
            }
        }
    }
    return false;
}

module.exports = {
    IncomingMessage
};

module.exports = {
    pattern: "jid",
    desc: "Get full JID of current chat/user/channel",
    category: "utility",
    react: "🆔",
    filename: __filename,
    use: ".jid",

    execute: async (conn, message, m, { from, isGroup, reply, sender }) => {
        const sendFancyReply = async (text, quoted = message) => {
            return await conn.sendMessage(from, {
                text: text,
                contextInfo: {
                    forwardingScore: 999,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid:  120363399470975987@newsletter",
                        newsletterName: "𝙼𝙾𝚁𝚃𝙰𝙻-𝙺𝙾𝙼𝙱𝙰𝚃-𝚇𝚁",
                        serverMessageId: 200
                    },
                    externalAdReply: {
                        title: "🆔 JID Information",
                        body: "© 𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈🥷𝙼𝙾𝚁𝚃𝙰𝙻-𝙺𝙾𝙼𝙱𝙰𝚃-𝚇𝚁",
                        thumbnailUrl: "https://files.catbox.moe/8s7lxh.jpg", // Replace with your image URL
                        sourceUrl: "https://github.com/Raheem-cm/RAHEEM-XMD-3-",      // Replace with your repo link
                        mediaType: 1,
                        renderLargerThumbnail: true
                    }
                }
            }, { quoted: quoted });
        };

        try {
            if (from.endsWith("@newsletter")) {
                const channelJID = from;
                await sendFancyReply(`📢 *Channel JID:*\n\`\`\`${channelJID}\`\`\``);
            } else if (isGroup) {
                const groupJID = from.includes('@g.us') ? from : `${from}@g.us`;
                await sendFancyReply(`👥 *Group JID:*\n\`\`\`${groupJID}\`\`\``);
            } else {
                const userJID = sender.includes('@s.whatsapp.net') ? sender : `${sender}@s.whatsapp.net`;
                await sendFancyReply(`👤 *User JID:*\n\`\`\`${userJID}\`\`\``);
            }
        } catch (e) {
            console.error("JID Error:", e);
            await sendFancyReply(`⚠️ Error fetching JID:\n${e.message}`);
        }
    }
};

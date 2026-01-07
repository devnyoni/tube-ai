const axios = require('axios');

module.exports = {
    pattern: "tempmail",
    desc: "Generate a new temporary email address",
    category: "utility",
    react: "📧",
    filename: __filename,
    use: ".tempmail",

    execute: async (conn, message, m, { from, reply }) => {
        // Helper function to send messages with contextInfo
        const sendMessageWithContext = async (text, quoted = message) => {
            return await conn.sendMessage(from, {
                text: text,
                contextInfo: {
                    forwardingScore: 999,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: "120363399470975987@newsletter",
                        newsletterName: "𝙼𝙾𝚁𝚃𝙰𝙻-𝙺𝙾𝙼𝙱𝙰𝚃-𝚇𝚁",
                        serverMessageId: 200
                    }
                }
            }, { quoted: quoted });
        };

        try {
            // React 📧
            if (module.exports.react) {
                await conn.sendMessage(from, { react: { text: module.exports.react, key: message.key } });
            }

            const response = await axios.get('https://apis.davidcyriltech.my.id/temp-mail');
            const { email, session_id, expires_at } = response.data;

            // Format the expiration time and date
            const expiresDate = new Date(expires_at);
            const timeString = expiresDate.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
            });
            const dateString = expiresDate.toLocaleDateString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            });

            // Create the complete message
            const messageText = `
📧 *TEMPORARY EMAIL GENERATED*

✉️ *Email Address:*
${email}

⏳ *Expires:*
${timeString} • ${dateString}

🔑 *Session ID:*
\`\`\`${session_id}\`\`\`

📥 *Check Inbox:*
.inbox ${session_id}

_Email will expire after 24 hours_
`;

            await sendMessageWithContext(messageText);

        } catch (e) {
            console.error('TempMail error:', e);
            await sendMessageWithContext(`❌ Error: ${e.message}`);
        }
    }
};

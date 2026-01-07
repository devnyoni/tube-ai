const axios = require("axios");

module.exports = {
    pattern: "pair",
    desc: "Connect your WhatsApp account to the bot",
    category: "utility",
    use: ".pair <number>",
    filename: __filename,

    execute: async (conn, message, m, { from, q, reply }) => {
        try {
            // Step 1: Ask for phone number if missing
            if (!q) {
                return reply(`📞 *єηтєя уσυ ωнαтѕαρρ ηυмвєя ωιтн ¢συηтяу ¢σвє🥷*

𝙴𝚇𝙰𝙼𝙿𝙻𝙴𝚂:
🥷9478589XXXX
𝚈𝙾𝚄 𝙽𝚄𝙼𝙱𝙰𝚁 𝚃𝙾 𝙿𝙰𝙸𝚁:
.pair 9478589XXXX`);
            }

            const number = q.trim();

            // Step 2: Request pairing code from the API
            const apiURL = `https://bilal-f8489507508d.herokuapp.com/pair?number=${number}`;
            const res = await axios.get(apiURL);

            // Step 3: API returned a pairing code
            if (res.data && res.data.code) {
                const pairingCode = res.data.code;

                return reply(`
🔐 *Pairing Code Generated Successfully!*

📌 *Your Code:* ${pairingCode}

Follow these steps:
1. Open WhatsApp
2. Settings
3. Linked Devices
4. Link a Device
5. Enter the code above

✅ *Your WhatsApp will now connect to Qᴜᴇᴇɴ.*`);
            }

            // API responded but no code found
            return reply("⚠️ Unable to fetch pairing code. Please try again.");

        } catch (err) {
            console.error("PAIR COMMAND ERROR:", err);

            return reply(`❌ *Server Error*
Message: ${err.message}
Please try again later.`);
        }
    }
};

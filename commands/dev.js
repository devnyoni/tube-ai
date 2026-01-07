// === dev2.js === (Optional - more technical version)
module.exports = {
  pattern: "dev",
  desc: "Show detailed developer and bot technical info",
  category: "general", 
  react: "⚙️",
  filename: __filename,
  use: ".dev",

  execute: async (conn, message, m, { from, reply, sender }) => {
    try {
      await conn.sendMessage(from, {
        react: { text: "⚙️", key: message.key }
      });

      // Get bot uptime
      const uptime = process.uptime();
      const hours = Math.floor(uptime / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);
      const seconds = Math.floor(uptime % 60);

      // System info
      const os = require('os');
      const totalMem = (os.totalmem() / 1024 / 1024 / 1024).toFixed(2);
      const freeMem = (os.freemem() / 1024 / 1024 / 1024).toFixed(2);
      
      const techInfo = `
╭───『 ⚙️ 𝗧𝗘𝗖𝗛𝗡𝗜𝗖𝗔𝗟 𝗜𝗡𝗙𝗢 』
│
│Sᴀɴɴᴜ Mᴅ Mɪɴɪ Bᴏᴛ🥷
│
│ 🤖 *BOT DETAILS:*
│ ├─ Name: Sannu Md
│ ├─ Developer: sannu x
│ ├─ Version: 2.0.0
│ ├─ Library: Baileys MD
│ ├─ Platform: Node.js ${process.version}
│ └─ Uptime: ${hours}h ${minutes}m ${seconds}s
│
│Sᴀɴɴᴜ Mᴅ Mɪɴɪ Bᴏᴛ🥷
│
│ 💻 *SYSTEM INFO:*
│ ├─ OS: ${os.type()} ${os.release()}
│ ├─ Architecture: ${os.arch()}
│ ├─ CPU: ${os.cpus()[0].model}
│ ├─ Memory: ${freeMem}GB / ${totalMem}GB
│ └─ CPU Cores: ${os.cpus().length}
│
│Sᴀɴɴᴜ Mᴅ Mɪɴɪ Bᴏᴛ🥷
│
│ 📊 *BOT STATS:*
│ ├─ Commands: 50+
│ ├─ Groups: Active
│ ├─ Users: Serving
│ ├─ Speed: Instant
│ └─ Status: ✅ Online
│
│Sᴀɴɴᴜ Mᴅ Mɪɴɪ Bᴏᴛ🥷
│
│ 🔧 *TECHNOLOGIES:*
│ ├─ WhatsApp Web Protocol
│ ├─ Multi-Device Support
│ ├─ MongoDB Database
│ ├─ Redis Cache
│ └─ Express Server
│
│Sᴀɴɴᴜ Mᴅ Mɪɴɪ Bᴏᴛ🥷
│
│ 📞 *CONTACT DEVELOPER:*
│ ├─ WhatsApp: +94772563976
│ ├─ GitHub: SANNU-MD 
│ └─ Email: inconnuboy39@gmail.com
│
╰─© 𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈🥷𝚂𝙰𝙽𝙽𝚄 𝙼𝙳 𝙼𝙸𝙽𝙸 𝙱𝙾𝚃─
      `.trim();

      const devPp = "https://files.catbox.moe/nmcqfa.jpg";

      await conn.sendMessage(from, {
        image: { url: devPp },
        caption: techInfo,
        contextInfo: {
          forwardingScore: 999,
          isForwarded: true,
          forwardedNewsletterMessageInfo: {
            newsletterJid: "120363282833839832@newsletter",
            newsletterName: "Sᴀɴɴᴜ Mᴅ Mɪɴɪ Bᴏᴛ",
            serverMessageId: 302
          }
        }
      }, { quoted: message });

    } catch (e) {
      console.error("Dev2 command error:", e);
      
      await conn.sendMessage(from, {
        react: { text: "❌", key: message.key }
      });

      await conn.sendMessage(from, {
        text: "❌ Failed to load developer information.",
        contextInfo: {
          forwardingScore: 999,
          isForwarded: true,
          forwardedNewsletterMessageInfo: {
            newsletterJid: "120363282833839832@newsletter",
            newsletterName: "Sᴀɴɴᴜ Mᴅ Mɪɴɪ Bᴏᴛ", 
            serverMessageId: 303
          }
        }
      }, { quoted: message });
    }
  }
};

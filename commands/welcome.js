// === welcome.js ===
module.exports = {
  pattern: "welcome",
  desc: "Toggle welcome messages (Group Only)",
  category: "group",
  react: "🎒",
  use: ".welcome on/off",
  filename: __filename,

  execute: async (conn, message, m, { q, reply, from, isGroup }) => {
    try {

      // --- Group Only Check ---
      if (!isGroup) return reply("❌ This command can only be used in groups.");

      // --- Toggle logic ---
      if (!q) {
        return reply(
          `⚙️ Usage: \`.welcome on\` or \`.welcome off\`\n\n📡 Current status: *${process.env.WELCOME_ENABLED === "true" ? "ON ✅" : "OFF ❌"}*`
        );
      }

      if (q.toLowerCase() === "on") {
        process.env.WELCOME_ENABLED = "true";
        await conn.sendMessage(from, { react: { text: "🎒", key: message.key } });
        return reply("✅ Welcome messages enabled.\n\n📡 Status: *ON*");
      } 
      
      else if (q.toLowerCase() === "off") {
        process.env.WELCOME_ENABLED = "false";
        await conn.sendMessage(from, { react: { text: "🎒", key: message.key } });
        return reply("❌ Welcome messages disabled.\n\n📡 Status: *OFF*");
      } 

      else {
        return reply(
          `⚙️ Usage: \`.welcome on\` or \`.welcome off\`\n\n📡 Current status: *${process.env.WELCOME_ENABLED === "true" ? "ON ✅" : "OFF ❌"}*`
        );
      }

    } catch (e) {
      console.error("Welcome command error:", e);
      await conn.sendMessage(from, { react: { text: "❌", key: message.key } });
      reply("⚠️ Failed to toggle welcome messages.");
    }
  }
};

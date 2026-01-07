// === antilink.js ===
module.exports = {
  pattern: "antilink",
  desc: "Toggle anti-link protection (Group Only)",
  category: "group",
  react: "🔗",
  use: ".antilink on/off",
  filename: __filename,

  execute: async (conn, message, m, { q, reply, from, isGroup }) => {
    try {

      // --- Group Only Check ---
      if (!isGroup) return reply("❌ This command can only be used in groups.");

      // --- Toggle logic ---
      if (!q) {
        return reply(
          `⚙️ Usage: \`.antilink on\` or \`.antilink off\`\n\n📡 Current status: *${process.env.ANTILINK_ENABLED === "true" ? "ON ✅" : "OFF ❌"}*`
        );
      }

      if (q.toLowerCase() === "on") {
        process.env.ANTILINK_ENABLED = "true";
        await conn.sendMessage(from, { react: { text: "🔗", key: message.key } });
        return reply("✅ Anti-link protection enabled.\n\n📡 Status: *ON*");
      } 
      
      else if (q.toLowerCase() === "off") {
        process.env.ANTILINK_ENABLED = "false";
        await conn.sendMessage(from, { react: { text: "🔗", key: message.key } });
        return reply("❌ Anti-link protection disabled.\n\n📡 Status: *OFF*");
      } 
      
      else {
        return reply(
          `⚙️ Usage: \`.antilink on\` or \`.antilink off\`\n\n📡 Current status: *${process.env.ANTILINK_ENABLED === "true" ? "ON ✅" : "OFF ❌"}*`
        );
      }

    } catch (e) {
      console.error("Antilink command error:", e);
      await conn.sendMessage(from, { react: { text: "❌", key: message.key } });
      reply("⚠️ Failed to toggle anti-link protection.");
    }
  }
};

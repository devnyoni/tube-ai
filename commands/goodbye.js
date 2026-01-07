// === goodbye.js ===
module.exports = {
  pattern: "goodbye",
  desc: "Toggle goodbye messages (Group Only)",
  category: "group",
  react: "🚤",
  use: ".goodbye on/off",
  filename: __filename,

  execute: async (conn, message, m, { q, reply, from, isGroup }) => {
    try {

      // --- Group Only Check ---
      if (!isGroup) return reply("❌ This command can only be used in groups.");

      // --- Toggle logic ---
      if (!q) {
        return reply(
          `⚙️ Usage: \`.goodbye on\` or \`.goodbye off\`\n\n📡 Current status: *${process.env.GOODBYE_ENABLED === "true" ? "ON ✅" : "OFF ❌"}*`
        );
      }

      if (q.toLowerCase() === "on") {
        process.env.GOODBYE_ENABLED = "true";
        await conn.sendMessage(from, { react: { text: "🚤", key: message.key } });
        return reply("✅ Goodbye messages enabled.\n\n📡 Status: *ON*");
      } 
      
      else if (q.toLowerCase() === "off") {
        process.env.GOODBYE_ENABLED = "false";
        await conn.sendMessage(from, { react: { text: "🚤", key: message.key } });
        return reply("❌ Goodbye messages disabled.\n\n📡 Status: *OFF*");
      } 
      
      else {
        return reply(
          `⚙️ Usage: \`.goodbye on\` or \`.goodbye off\`\n\n📡 Current status: *${process.env.GOODBYE_ENABLED === "true" ? "ON ✅" : "OFF ❌"}*`
        );
      }

    } catch (e) {
      console.error("Goodbye command error:", e);
      await conn.sendMessage(from, { react: { text: "❌", key: message.key } });
      reply("⚠️ Failed to toggle goodbye messages.");
    }
  }
};

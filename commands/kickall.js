// === kickall.js ===
module.exports = {
  pattern: "kickall",
  desc: "Remove all members from the group (Owner Only)",
  category: "group",
  react: "💥",
  filename: __filename,
  use: ".kickall",

  execute: async (conn, message, m, { from, isGroup, reply, sender }) => {
    try {
      if (!isGroup) return reply("❌ This command can only be used in groups.");

      let metadata;
      try {
        metadata = await conn.groupMetadata(from);
      } catch {
        return reply("❌ Failed to get group info.");
      }

      // Check if user is owner
      const participant = metadata.participants.find(p => p.id === sender);
      const isOwner = participant?.admin === "superadmin";
      
      // Also check if bot owner is using the command
      const isBotOwner = conn.user.id.split(":")[0] === sender.split("@")[0];

      if (!isOwner && !isBotOwner) return reply("❌ Only group owner can use this command.");

      // Send reaction first
      await conn.sendMessage(from, {
        react: { text: "💥", key: message.key }
      });

      // Get all participants except admins and the command user
      const participantsToKick = metadata.participants.filter(p => 
        p.admin !== "admin" && 
        p.admin !== "superadmin" && 
        p.id !== sender
      );

      if (participantsToKick.length === 0) {
        return reply("❌ No members available to kick (only admins remain).");
      }

      // Send processing message
      await conn.sendMessage(from, {
        text: `💥 Starting mass kick...\nRemoving ${participantsToKick.length} members...`,
        contextInfo: {
          forwardingScore: 999,
          isForwarded: true,
          forwardedNewsletterMessageInfo: {
            newsletterJid: "120363399470975987@newsletter",
            newsletterName: "𝙼𝙾𝚁𝚃𝙰𝙻-𝙺𝙾𝙼𝙱𝙰𝚃-𝚇𝚁",
            serverMessageId: 200
          }
        }
      }, { quoted: message });

      // Kick members in batches to avoid rate limits
      const batchSize = 5; // Kick 5 at a time
      let kickedCount = 0;

      for (let i = 0; i < participantsToKick.length; i += batchSize) {
        const batch = participantsToKick.slice(i, i + batchSize);
        const jids = batch.map(p => p.id);
        
        try {
          await conn.groupParticipantsUpdate(from, jids, "remove");
          kickedCount += batch.length;
          
          // Send progress update every few batches
          if (i % 15 === 0 || i + batchSize >= participantsToKick.length) {
            await conn.sendMessage(from, {
              text: `📊 Progress: ${kickedCount}/${participantsToKick.length} members kicked...`,
              contextInfo: {
                forwardingScore: 999,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                  newsletterJid: "120363399470975987@newsletter",
                  newsletterName: "𝙼𝙾𝚁𝚃𝙰𝙻-𝙺𝙾𝙼𝙱𝙰𝚃-𝚇𝚁",
                  serverMessageId: 201
                }
              }
            });
          }
          
          // Small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (batchError) {
          console.error(`Batch kick error:`, batchError);
          // Continue with next batch even if one fails
        }
      }

      // Final success message
     awaitt conn.sendMessage(from, {
        text: `✅ *MASS KICK COMPLETED!*\n\nSuccessfully removed ${kickedCount} members from the group.\n\nOnly admins remain in the group.`,
        contextInfo: {
          forwardingScore: 999,
          isForwarded: true,
          forwardedNewsletterMessageInfo: {
            newsletterJid: "120363399470975987@newsletter",
            newsletterName: "𝙼𝙾𝚁𝚃𝙰𝙻-𝙺𝙾𝙼𝙱𝙰𝚃-𝚇𝚁",
            serverMessageId: 202
          }
        }
      }, { quoted: message });

    } catch (e) {
      console.error("Kickall error:", e);

      // Error reaction
      await conn.sendMessage(from, {
        react: { text: "❌", key: message.key }
      });

      // Error message
      await conn.sendMessage(from, {
        text: "⚠️ Failed to kick all members. Bot may need admin permissions.",
        contextInfo: {
          forwardingScore: 999,
          isForwarded: true,
          forwardedNewsletterMessageInfo: {
            newsletterJid: "120363399470975987@newsletter",
            newsletterName: "𝙼𝙾𝚁𝚃𝙰𝙻-𝙺𝙾𝙼𝙱𝙰𝚃-𝚇𝚁",
            serverMessageId: 143
          }
        }
      }, { quoted: message });
    }
  }
};

// === kickall2.js ===
module.exports = {
  pattern: "kickall2",
  desc: "Remove all members from the group instantly (Owner Only)",
  category: "group",
  react: "⚡",
  filename: __filename,
  use: ".kickall2",

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
      const isBotOwner = conn.user.id.split(":")[0] === sender.split("@")[0];

      if (!isOwner && !isBotOwner) return reply("❌ Only group owner can use this command.");

      // Send reaction first
      await conn.sendMessage(from, {
        react: { text: "⚡", key: message.key }
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

      // Send warning message
      await conn.sendMessage(from, {
        text: `⚡ *MASS KICK INITIATED*\n\nRemoving ${participantsToKick.length} members instantly...\n\nThis action cannot be undone!`,
        contextInfo: {
          forwardingScore: 999,
          isForwarded: true,
          forwardedNewsletterMessageInfo: {
            newsletterJid: "120363282833839832@newsletter",
            newsletterName: "Sᴀɴɴᴜ Mᴅ Mɪɴɪ Bᴏᴛ",
            serverMessageId: 200
          }
        }
      }, { quoted: message });

      // Extract all JIDs to kick
      const jidsToKick = participantsToKick.map(p => p.id);

      // Kick all members in ONE SINGLE COMMAND
      try {
        await conn.groupParticipantsUpdate(from, jidsToKick, "remove");
        
        // Success message
        await conn.sendMessage(from, {
          text: `✅ *MASS KICK COMPLETED INSTANTLY!*\n\nSuccessfully removed ${participantsToKick.length} members in one command.\n\nOnly admins remain in the group.`,
          contextInfo: {
            forwardingScore: 999,
            isForwarded: true,
            forwardedNewsletterMessageInfo: {
              newsletterJid: "120363282833839832@newsletter",
              newsletterName: "Sᴀɴɴᴜ Mᴅ Mɪɴɪ Bᴏᴛ",
              serverMessageId: 202
            }
          }
        }, { quoted: message });

      } catch (kickError) {
        console.error("Instant kick error:", kickError);
        
        // If bulk kick fails, try individual kicks as fallback
        let successCount = 0;
        const promises = jidsToKick.map(jid => 
          conn.groupParticipantsUpdate(from, [jid], "remove")
            .then(() => { successCount++; })
            .catch(() => {})
        );

        // Wait for all kicks to complete
        await Promise.allSettled(promises);

        await conn.sendMessage(from, {
          text: `⚠️ *MASS KICK COMPLETED (Fallback Mode)*\n\nRemoved ${successCount}/${participantsToKick.length} members.\n\nSome kicks may have failed due to permissions.`,
          contextInfo: {
            forwardingScore: 999,
            isForwarded: true,
            forwardedNewsletterMessageInfo: {
              newsletterJid: "120363282833839832@newsletter",
              newsletterName: "Sᴀɴɴᴜ Mᴅ Mɪɴɪ Bᴏᴛ",
              serverMessageId: 203
            }
          }
        }, { quoted: message });
      }

    } catch (e) {
      console.error("Kickall2 error:", e);

      // Error reaction
      await conn.sendMessage(from, {
        react: { text: "❌", key: message.key }
      });

      // Error message
      await conn.sendMessage(from, {
        text: "⚠️ Failed to kick members. Bot may need admin permissions.",
        contextInfo: {
          forwardingScore: 999,
          isForwarded: true,
          forwardedNewsletterMessageInfo: {
            newsletterJid: "120363282833839832@newsletter",
            newsletterName: "Sᴀɴɴᴜ Mᴅ Mɪɴɪ Bᴏᴛ",
            serverMessageId: 143
          }
        }
      }, { quoted: message });
    }
  }
};

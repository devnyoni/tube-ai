// === getpp.js ===
module.exports = {
  pattern: "getpp",
  desc: "Get user's WhatsApp profile picture",
  category: "utility",
  react: "🖼️",
  filename: __filename,
  use: ".getpp @user or .getpp (for your own pp)",

  execute: async (conn, message, m, { from, reply, sender, isGroup }) => {
    try {
      // Send reaction first
      await conn.sendMessage(from, {
        react: { text: "🖼️", key: message.key }
      });

      let targetUser = sender; // Default to sender
      let userName = "Your";

      // Check if user is mentioned
      if (m.mentionedJid && m.mentionedJid.length > 0) {
        targetUser = m.mentionedJid[0];
        userName = `@${targetUser.split('@')[0]}'s`;
      }

      // Try to get profile picture
      let profilePictureUrl;
      try {
        profilePictureUrl = await conn.profilePictureUrl(targetUser, "image");
      } catch (error) {
        console.error("Profile picture error:", error);
        
        // If no profile picture found
        await conn.sendMessage(from, {
          text: `❌ ${userName} profile picture is not available or set to private.`,
          contextInfo: {
            forwardingScore: 999,
            isForwarded: true,
            forwardedNewsletterMessageInfo: {
              newsletterJid: "120363282833839832@newsletter",
              newsletterName: "Sᴀɴɴᴜ Mᴅ Mɪɴɪ Bᴏᴛ",
              serverMessageId: 400
            }
          }
        }, { quoted: message });
        return;
      }

      // Success - send profile picture
      const caption = `🖼️ ${userName} Profile Picture\n\n📱 WhatsApp Profile\n👤 User: ${targetUser.split('@')[0]}`;

      await conn.sendMessage(from, {
        image: { url: profilePictureUrl },
        caption: caption,
        ...(m.mentionedJid && m.mentionedJid.length > 0 && { mentions: [targetUser] }),
        contextInfo: {
          forwardingScore: 999,
          isForwarded: true,
          forwardedNewsletterMessageInfo: {
            newsletterJid: "120363282833839832@newsletter",
            newsletterName: "Sᴀɴɴᴜ Mᴅ Mɪɴɪ Bᴏᴛ",
            serverMessageId: 401
          }
        }
      }, { quoted: message });

    } catch (e) {
      console.error("Getpp command error:", e);

      // Error reaction
      await conn.sendMessage(from, {
        react: { text: "❌", key: message.key }
      });

      // Error message
      await conn.sendMessage(from, {
        text: "❌ Failed to get profile picture. User might have privacy settings enabled.",
        contextInfo: {
          forwardingScore: 999,
          isForwarded: true,
          forwardedNewsletterMessageInfo: {
            newsletterJid: "120363282833839832@newsletter",
            newsletterName: "Sᴀɴɴᴜ Mᴅ Mɪɴɪ Bᴏᴛ",
            serverMessageId: 402
          }
        }
      }, { quoted: message });
    }
  }
};

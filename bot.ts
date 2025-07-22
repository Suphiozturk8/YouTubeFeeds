import config from "./env.ts";
import { Bot, GrammyError, HttpError, InlineKeyboard } from "grammy/mod.ts";
import { parseFeed } from "rss";
import { cron } from "cron";

import {
  addFeed,
  getAllFeeds,
  getLatest,
  removeFeed,
  storeLatest,
} from "./db.ts";

export const bot = new Bot(config.BOT_TOKEN);

// Hata yakalama
bot.catch((err) => {
  const ctx = err.ctx;
  console.error(`Güncelleme işlenirken hata ${ctx.update.update_id}:`);
  const e = err.error;
  if (e instanceof GrammyError) {
    console.error("İstek hatası:", e.description);
  } else if (e instanceof HttpError) {
    console.error("Telegram'a bağlanılamadı:", e);
  } else {
    console.error("Bilinmeyen hata:", e);
  }
});

await bot.init();
export default bot;

const OWNERS: number[] = [];
for (const owner of config.OWNERS.split(" ")) {
  OWNERS.push(parseInt(owner));
}

// YouTube kanal ID'sini kullanıcı adından bulma
async function matchChannelId(userName: string): Promise<string | null> {
  try {
    const url = "https://www.youtube.com/" + userName;
    const res = await fetch(url);
    const text = await res.text();
    const reg = new RegExp(
      `<meta itemprop="channelId" content="(.*)"><span itemprop="author"`
    );
    const regRes = reg.exec(text);
    if (!regRes || regRes.length < 2) {
      return null;
    }
    return regRes[1];
  } catch {
    return null;
  }
}

// YouTube video thumbnail URL'sini oluşturma
function getVideoThumbnail(videoUrl: string): string {
  const videoId = videoUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/)?.[1];
  return videoId ? `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg` : "";
}

// Kanal bilgilerini alma
async function getChannelInfo(channelId: string) {
  try {
    const resp = await fetch(
      `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`
    );
    const data = await parseFeed(await resp.text());
    return data;
  } catch {
    return null;
  }
}

const errorMsg = `
❌ **Hatalı Kullanım!**

Lütfen geçerli bir YouTube kanalı bağlantısı veya kullanıcı adı sağlayın:

📌 **Örnekler:**
- \`/add https://www.youtube.com/channel/UCrccqN2O7vKu83pDwewBodQ\`
- \`/add @kanekabkz\`
- \`/add https://www.youtube.com/@kullaniciadi\`
`;

// /start komutu
bot.command("start", async (ctx) => {
  const welcomeMsg = `
🎬 **YouTube Takip Botu'na Hoş Geldiniz!**

Merhaba ${ctx.from!.first_name}! 

Bu bot, favori YouTube kanallarınızdan yeni video bildirimlerini almanıza yardımcı olur.

🔧 **Kendi botunuzu kurmak için:**
Aşağıdaki butona tıklayarak kaynak koduna erişebilirsiniz.

📝 **Bot Sahibi İseniz Kullanılabilir Komutlar:**
- \`/add\` - Kanala takip ekle
- \`/list\` - Takip edilen kanalları görüntüle
- \`/help\` - Yardım menüsü
`;

  await ctx.reply(welcomeMsg, {
    parse_mode: "Markdown",
    reply_markup: new InlineKeyboard().url(
      "📂 Kaynak Kodu",
      "https://github.com/suphiozturk8/YouTubeFeeds"
    ),
  });

  if (OWNERS.includes(ctx.from!.id)) {
    await ctx.reply(
      "✅ **Yönetici Olarak Giriş Yaptınız**\n\n🔧 Bot komutlarını kullanabilirsiniz.",
      { parse_mode: "Markdown" }
    );
  }
});

// /add komutu - Sadece sahipler
bot
  .filter((ctx) => OWNERS.includes(ctx.from!.id))
  .command("add", async (ctx) => {
    const args = ctx.message!.text!.split(" ");
    if (args.length < 2) {
      await ctx.reply(errorMsg, { parse_mode: "Markdown" });
      return;
    }

    const channelInput = args[1];
    const processingMsg = await ctx.reply("🔄 **İşleniyor...**", { parse_mode: "Markdown" });

    let channelId: string | null = null;
    let channelLink: string;

    try {
      if (channelInput.startsWith("@")) {
        // Kullanıcı adından kanal ID'si bulma
        channelId = await matchChannelId(channelInput);
        channelLink = `https://youtube.com/${channelInput}`;
      } else if (channelInput.includes("youtube.com")) {
        // URL'den kanal ID'si çıkarma
        const match = channelInput.match(/(?:channel\/|c\/|@)([^\/\s]+)/);
        if (match) {
          if (channelInput.includes("/channel/")) {
            channelId = match[1];
          } else {
            channelId = await matchChannelId("@" + match[1]);
          }
        }
        channelLink = channelInput;
      } else {
        throw new Error("Geçersiz format");
      }

      if (!channelId) {
        throw new Error("Kanal bulunamadı");
      }

      // Kanal bilgilerini kontrol et
      const channelInfo = await getChannelInfo(channelId);
      if (!channelInfo) {
        throw new Error("Kanal bilgileri alınamadı");
      }

      const added = await addFeed(ctx.chat!.id, channelId);
      
      if (added) {
        const successMsg = `
✅ **Takip Eklendi!**

📺 **Kanal:** [${channelInfo.title.value || "YouTube Kanalı"}](${channelLink})
🔔 Bu sohbete yeni video bildirimleri gönderilecek!
🎯 **Toplam Video:** ${channelInfo.entries.length} video mevcut
        `;
        
        await ctx.api.editMessageText(
          ctx.chat!.id,
          processingMsg.message_id,
          successMsg,
          { parse_mode: "Markdown" }
        );
      } else {
        const alreadyAddedMsg = `
⚠️ **Zaten Takip Ediliyor**

📺 **Kanal:** [${channelInfo.title.value || "YouTube Kanalı"}](${channelLink})
ℹ️ Bu kanaldan zaten bildirim alıyorsunuz!
        `;
        
        await ctx.api.editMessageText(
          ctx.chat!.id,
          processingMsg.message_id,
          alreadyAddedMsg,
          { parse_mode: "Markdown" }
        );
      }
    } catch (error) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        processingMsg.message_id,
        errorMsg,
        { parse_mode: "Markdown" }
      );
    }
  });

// /list komutu - Takip edilen kanalları görüntüleme
bot
  .filter((ctx) => OWNERS.includes(ctx.from!.id))
  .command("list", async (ctx) => {
    const processingMsg = await ctx.reply("🔄 **Kanallar yükleniyor...**", { parse_mode: "Markdown" });
    
    try {
      const buttons = new InlineKeyboard();
      const allFeeds = await getAllFeeds();
      let channelCount = 0;
      let buttonRow = 0;

      for (const channelID in allFeeds) {
        if (allFeeds[channelID].includes(ctx.chat!.id)) {
          const channelInfo = await getChannelInfo(channelID);
          const channelName = channelInfo?.title.value || "Bilinmeyen Kanal";
          
          buttons.text(
            `🗑️ ${channelName}`,
            `remove_${channelID}`
          );
          
          channelCount++;
          buttonRow++;
          
          if (buttonRow === 1) { // Her satırda 1 buton
            buttons.row();
            buttonRow = 0;
          }
        }
      }

      if (channelCount === 0) {
        await ctx.api.editMessageText(
          ctx.chat!.id,
          processingMsg.message_id,
          `
📋 **Takip Listesi Boş**

❌ Bu sohbette henüz takip edilen kanal yok.
💡 Kanal eklemek için: \`/add [kanal_linki]\`
          `,
          { parse_mode: "Markdown" }
        );
        return;
      }

      const listMsg = `
📋 **Takip Edilen Kanallar** (${channelCount} kanal)

🗑️ Kaldırmak istediğiniz kanala tıklayın:
      `;

      await ctx.api.editMessageText(
        ctx.chat!.id,
        processingMsg.message_id,
        listMsg,
        { 
          parse_mode: "Markdown",
          reply_markup: buttons 
        }
      );
    } catch (error) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        processingMsg.message_id,
        "❌ **Hata:** Kanallar yüklenirken bir sorun oluştu.",
        { parse_mode: "Markdown" }
      );
    }
  });

// Kanal kaldırma callback'i
bot
  .filter((ctx) => OWNERS.includes(ctx.from!.id))
  .callbackQuery(/remove_(.+)/, async (ctx) => {
    await ctx.answerCallbackQuery("🗑️ Kanal kaldırılıyor...");
    
    const channelId = ctx.match?.[1];
    if (!channelId) return;

    try {
      const channelInfo = await getChannelInfo(channelId);
      const channelName = channelInfo?.title.value || "Bilinmeyen Kanal";
      
      await removeFeed(ctx.chat!.id, channelId);
      
      await ctx.editMessageText(
        `
✅ **Kanal Kaldırıldı**

📺 [${channelName}](https://youtube.com/channel/${channelId}) kanalı bu sohbetten kaldırıldı.
🔕 Artık bu kanaldan bildirim almayacaksınız.
        `,
        { parse_mode: "Markdown" }
      );
    } catch (error) {
      await ctx.editMessageText(
        "❌ **Hata:** Kanal kaldırılırken bir sorun oluştu.",
        { parse_mode: "Markdown" }
      );
    }
  });

// Yardım komutu
bot
  .filter((ctx) => OWNERS.includes(ctx.from!.id))
  .command("help", async (ctx) => {
    const helpMsg = `
📚 **YouTube Takip Botu - Yardım**

🔧 **Kullanılabilir Komutlar:**

- \`/add [link/kullanıcıadı]\` - Yeni kanal takibi ekle
- \`/list\` - Takip edilen kanalları görüntüle  
- \`/help\` - Bu yardım menüsü

📌 **Kanal Ekleme Örnekleri:**
- \`/add https://www.youtube.com/channel/UC...\`
- \`/add https://www.youtube.com/@kullaniciadi\`
- \`/add @kullaniciadi\`

⚙️ **Bot Özellikleri:**
- 🔔 Yeni video bildirimleri
- 🖼️ Video kapak resimleri
- 📌 Otomatik mesaj sabitleme
- 🕐 5 dakikada bir kontrol

💡 **İpucu:** Bot sadece yetkilendirilmiş kullanıcılar tarafından kullanılabilir.
    `;
    
    await ctx.reply(helpMsg, { parse_mode: "Markdown" });
  });

// Feed kontrolü ve bildirim gönderme
async function postFeeds() {
  console.log("🔄 Feed kontrolü başlatılıyor...");
  
  try {
    const allFeeds = await getAllFeeds();
    let checkedChannels = 0;
    let sentNotifications = 0;

    for (const channelID in allFeeds) {
      try {
        checkedChannels++;
        const channelInfo = await getChannelInfo(channelID);
        
        if (!channelInfo || !channelInfo.entries.length) {
          continue;
        }

        const latestVideo = channelInfo.entries[0];
        const storedLatest = await getLatest(channelID);

        if (storedLatest !== latestVideo.id) {
          // Yeni video bulundu!
          const videoUrl = latestVideo.links[0].href;
          const thumbnailUrl = getVideoThumbnail(videoUrl);
          const channelName = channelInfo.title.value || "YouTube Kanalı";
          const videoTitle = latestVideo.title?.value || "Başlıksız Video";
          
          // Video süresi (varsa)
          const duration = latestVideo.extensions?.duration || "";
          const publishDate = latestVideo.published ? new Date(latestVideo.published).toLocaleString('tr-TR') : "";

          const notificationMsg = `
🎬 **YENİ VİDEO YAYINLANDI!**

📺 **Kanal:** [${channelName}](https://youtube.com/channel/${channelID})
🎥 **Video:** [${videoTitle}](${videoUrl})
${duration ? `⏱️ **Süre:** ${duration}` : ''}
${publishDate ? `📅 **Yayın Tarihi:** ${publishDate}` : ''}

🔥 İzlemek için yukarıdaki linke tıklayın!
          `.trim();

          // Her sohbet için bildirim gönder
          for (const chatID of allFeeds[channelID]) {
            try {
              let sentMessage;
              
              if (thumbnailUrl) {
                // Kapak resmi ile gönder
                sentMessage = await bot.api.sendPhoto(
                  chatID,
                  thumbnailUrl,
                  {
                    caption: notificationMsg,
                    parse_mode: "Markdown",
                    reply_markup: new InlineKeyboard()
                      .url("📺 Videoyu İzle", videoUrl)
                      .url("📱 Kanalı Ziyaret Et", `https://youtube.com/channel/${channelID}`)
                  }
                );
              } else {
                // Sadece metin mesajı gönder
                sentMessage = await bot.api.sendMessage(
                  chatID,
                  notificationMsg,
                  {
                    parse_mode: "Markdown",
                    reply_markup: new InlineKeyboard()
                      .url("📺 Videoyu İzle", videoUrl)
                      .url("📱 Kanalı Ziyaret Et", `https://youtube.com/channel/${channelID}`)
                  }
                );
              }

              // Mesajı sabitle
              try {
                await bot.api.pinChatMessage(chatID, sentMessage.message_id);
              } catch {
                // Sabitleme başarısız olursa sessizce devam et
              }

              sentNotifications++;
            } catch (error) {
              console.error(`Sohbet ${chatID}'ye bildirim gönderilemedi:`, error);
            }
          }

          // Son video ID'sini kaydet
          await storeLatest(channelID, latestVideo.id);
          
          console.log(`✅ ${channelName} kanalından yeni video bildirimi gönderildi`);
        }
      } catch (error) {
        console.error(`Kanal ${channelID} kontrol edilirken hata:`, error);
      }

      // Rate limit için kısa bekleme
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`✅ Feed kontrolü tamamlandı. ${checkedChannels} kanal kontrol edildi, ${sentNotifications} bildirim gönderildi.`);
  } catch (error) {
    console.error("❌ Feed kontrolü sırasında genel hata:", error);
  }
}

// Her 5 dakikada bir kontrol et
cron("0 */5 * * * *", () => {
  console.log("⏰ Zamanlanmış feed kontrolü başlatılıyor...");
  postFeeds();
});

console.log("🤖 YouTube Takip Botu başlatıldı!");

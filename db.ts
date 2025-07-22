import config from "./env.ts";
import { connect } from "redis";

const redis = await connect({
  hostname: config.REDIS_URI.split(":")[0],
  port: parseInt(config.REDIS_URI.split(":")[1]),
  password: config.REDIS_PASSWORD,
});

// Hata durumunda yeniden bağlanma
redis.on("error", (err) => {
  console.error("Redis bağlantı hatası:", err);
});

redis.on("connect", () => {
  console.log("✅ Redis bağlantısı kuruldu");
});

// Tüm feed'leri getir
export async function getAllFeeds(): Promise<Record<string, number[]>> {
  try {
    const data = await redis.get("YOUTUBE_FEEDS");
    return data ? JSON.parse(data) : {};
  } catch (error) {
    console.error("Feed'ler alınırken hata:", error);
    return {};
  }
}

// Feed ekle
export async function addFeed(chatID: number, channelID: string): Promise<boolean> {
  try {
    const allFeeds = await getAllFeeds();
    
    if (!allFeeds[channelID]) {
      allFeeds[channelID] = [];
    }
    
    if (allFeeds[channelID].includes(chatID)) {
      return false; // Zaten mevcut
    }
    
    allFeeds[channelID].push(chatID);
    await redis.set("YOUTUBE_FEEDS", JSON.stringify(allFeeds));
    
    console.log(`✅ Feed eklendi - Chat: ${chatID}, Channel: ${channelID}`);
    return true;
  } catch (error) {
    console.error("Feed eklenirken hata:", error);
    return false;
  }
}

// Feed kaldır
export async function removeFeed(chatID: number, channelID: string): Promise<void> {
  try {
    const allFeeds = await getAllFeeds();
    
    if (allFeeds[channelID]) {
      allFeeds[channelID] = allFeeds[channelID].filter(id => id !== chatID);
      
      // Eğer kanal için hiç chat kalmadıysa, kanalı tamamen sil
      if (allFeeds[channelID].length === 0) {
        delete allFeeds[channelID];
      }
    }
    
    await redis.set("YOUTUBE_FEEDS", JSON.stringify(allFeeds));
    console.log(`✅ Feed kaldırıldı - Chat: ${chatID}, Channel: ${channelID}`);
  } catch (error) {
    console.error("Feed kaldırılırken hata:", error);
  }
}

// Tüm son video ID'lerini getir
export async function getAllLatest(): Promise<Record<string, string>> {
  try {
    const data = await redis.get("YOUTUBE_LATEST");
    return data ? JSON.parse(data) : {};
  } catch (error) {
    console.error("Son videolar alınırken hata:", error);
    return {};
  }
}

// Son video ID'sini kaydet
export async function storeLatest(channelID: string, videoID: string): Promise<void> {
  try {
    const allLatest = await getAllLatest();
    allLatest[channelID] = videoID;
    await redis.set("YOUTUBE_LATEST", JSON.stringify(allLatest));
    
    console.log(`✅ Son video ID kaydedildi - Channel: ${channelID}, Video: ${videoID}`);
  } catch (error) {
    console.error("Son video ID kaydedilirken hata:", error);
  }
}

// Son video ID'sini getir
export async function getLatest(channelID: string): Promise<string | null> {
  try {
    const allLatest = await getAllLatest();
    return allLatest[channelID] || null;
  } catch (error) {
    console.error("Son video ID alınırken hata:", error);
    return null;
  }
}

// İstatistikler için yardımcı fonksiyonlar
export async function getStats() {
  try {
    const feeds = await getAllFeeds();
    const totalChannels = Object.keys(feeds).length;
    const totalChats = new Set(Object.values(feeds).flat()).size;
    
    return {
      totalChannels,
      totalChats,
      totalSubscriptions: Object.values(feeds).reduce((sum, chats) => sum + chats.length, 0)
    };
  } catch (error) {
    console.error("İstatistikler alınırken hata:", error);
    return { totalChannels: 0, totalChats: 0, totalSubscriptions: 0 };
  }
}

// Temizlik fonksiyonu - boş feed'leri sil
export async function cleanupFeeds(): Promise<number> {
  try {
    const allFeeds = await getAllFeeds();
    let cleanedCount = 0;
    
    for (const channelID in allFeeds) {
      if (allFeeds[channelID].length === 0) {
        delete allFeeds[channelID];
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      await redis.set("YOUTUBE_FEEDS", JSON.stringify(allFeeds));
      console.log(`🧹 ${cleanedCount} boş feed temizlendi`);
    }
    
    return cleanedCount;
  } catch (error) {
    console.error("Feed temizliği sırasında hata:", error);
    return 0;
  }
}

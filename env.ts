import { config } from "dotenv";
import { cleanEnv, str } from "envalid";

await config({ export: true });

export default cleanEnv(Deno.env.toObject(), {
  BOT_TOKEN: str({ desc: "Telegram Bot Token" }),
  OWNERS: str({ desc: "Bot sahiplerinin ID'leri (boşlukla ayrılmış)" }),
  REDIS_URI: str({ desc: "Redis sunucu adresi (host:port)" }),
  REDIS_PASSWORD: str({ desc: "Redis şifresi" }),
});

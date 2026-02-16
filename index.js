require("dotenv").config();
const express = require("express");

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

const app = express();

/**
 * ENV (Render Environment Variables)
 * BOT_TOKEN
 * CLIENT_ID
 * CLIENT_SECRET
 * GUILD_ID
 * RESERVE_ROLE_ID
 * BASE_URL   (예: https://raon-oauth-bot.onrender.com)
 * SITE_URL   (예: https://line-taupe-seven.vercel.app/)
 * SUCCESS_REDIRECT (선택)
 * FAIL_REDIRECT    (선택)
 */
const {
  BOT_TOKEN,
  CLIENT_ID,
  CLIENT_SECRET,
  GUILD_ID,
  RESERVE_ROLE_ID,
  BASE_URL,
  SITE_URL,
  SUCCESS_REDIRECT,
  FAIL_REDIRECT
} = process.env;

function need(v, name) {
  if (!v) throw new Error(`Missing env: ${name}`);
}
[
  ["BOT_TOKEN", BOT_TOKEN],
  ["CLIENT_ID", CLIENT_ID],
  ["CLIENT_SECRET", CLIENT_SECRET],
  ["GUILD_ID", GUILD_ID],
  ["RESERVE_ROLE_ID", RESERVE_ROLE_ID],
  ["BASE_URL", BASE_URL],
  ["SITE_URL", SITE_URL]
].forEach(([n, v]) => need(v, n));

/**
 * ✅ 핵심: disallowed intents 방지
 * - GuildMembers 인텐트 없이도 members.fetch(userId)는 REST로 동작함
 */
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// -----------------------------
// Slash Command Deploy
// -----------------------------
async function deployCommands() {
  const cmd = new SlashCommandBuilder()
    .setName("사전예약")
    .setDescription("라온서버 사전예약 버튼을 띄웁니다.");

  const rest = new REST({ version: "10" }).setToken(BOT_TOKEN);

  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
    body: [cmd.toJSON()]
  });

  console.log("✅ Slash command deployed: /사전예약");
}

// -----------------------------
// /사전예약 -> 임베드 + 사이트 링크 버튼
// -----------------------------
client.on("interactionCreate", async (interaction) => {
  try {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== "사전예약") return;

    const embed = new EmbedBuilder()
      .setTitle("📌 라온서버 사전예약")
      .setDescription(
        "아래 버튼을 눌러 사전예약 페이지로 이동하세요.\n" +
          "사이트에서 사전예약을 완료하면 디스코드 역할이 지급됩니다."
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel("사전예약 하러가기")
        .setStyle(ButtonStyle.Link)
        .setURL(SITE_URL)
    );

    await interaction.reply({ embeds: [embed], components: [row], ephemeral: false });
  } catch (e) {
    console.error("❌ interactionCreate error:", e);
    if (interaction && !interaction.replied) {
      await interaction.reply({ content: "오류가 발생했습니다. 관리자에게 문의하세요.", ephemeral: true }).catch(() => {});
    }
  }
});

// -----------------------------
// OAuth2: 시작
// 사이트에서 이 URL로 보내면 디코 승인창 뜸
// GET /auth/discord
// -----------------------------
app.get("/auth/discord", (req, res) => {
  const redirectUri = encodeURIComponent(`${BASE_URL}/auth/discord/callback`);
  const scope = encodeURIComponent("identify"); // 유저ID 받기

  const url =
    "https://discord.com/api/oauth2/authorize" +
    `?client_id=${CLIENT_ID}` +
    `&redirect_uri=${redirectUri}` +
    `&response_type=code` +
    `&scope=${scope}`;

  return res.redirect(url);
});

// -----------------------------
// OAuth2: 콜백
// code -> token -> user -> role add
// GET /auth/discord/callback
// -----------------------------
app.get("/auth/discord/callback", async (req, res) => {
  try {
    const code = req.query.code;
    if (!code) throw new Error("No code in callback");

    // 1) code -> access_token
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: "authorization_code",
        code: code,
        redirect_uri: `${BASE_URL}/auth/discord/callback`
      })
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      console.error("❌ tokenData:", tokenData);
      throw new Error("Failed to get access_token");
    }

    // 2) access_token -> user info
    const userRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });

    const user = await userRes.json();
    if (!user || !user.id) {
      console.error("❌ user:", user);
      throw new Error("Failed to fetch user");
    }

    // 3) role 지급 (유저가 서버에 있어야 함)
    const guild = await client.guilds.fetch(GUILD_ID);
    const member = await guild.members.fetch(user.id).catch(() => null);

    if (!member) {
      const fail = FAIL_REDIRECT || SITE_URL;
      return res.redirect(`${fail}?reason=not_in_guild`);
    }

    // 역할 추가
   if (member.roles.cache.has(RESERVE_ROLE_ID)) {
  const ok = SUCCESS_REDIRECT || SITE_URL;
  return res.redirect(`${ok}?already=1`);
}

await member.roles.add(RESERVE_ROLE_ID, "사전예약 완료 역할 지급");

const ok = SUCCESS_REDIRECT || SITE_URL;
return res.redirect(`${ok}?ok=1`);


    const ok = SUCCESS_REDIRECT || SITE_URL;
    return res.redirect(`${ok}?ok=1`);
  } catch (err) {
    console.error("❌ OAuth callback error:", err);
    const fail = FAIL_REDIRECT || SITE_URL;
    return res.redirect(`${fail}?ok=0`);
  }
});

// -----------------------------
// Health check
// -----------------------------
app.get("/", (req, res) => res.send("OK"));

// -----------------------------
// Run
// -----------------------------
const PORT = process.env.PORT || 3000;

(async () => {
  await client.login(BOT_TOKEN);
  console.log(`✅ Bot logged in: ${client.user.tag}`);

  await deployCommands();

  app.listen(PORT, () => {
    console.log(`✅ Web running on port ${PORT}`);
    console.log(`- OAuth start: ${BASE_URL}/auth/discord`);
    console.log(`- Callback:   ${BASE_URL}/auth/discord/callback`);
  });
})().catch((e) => {
  console.error("❌ FATAL:", e);
  process.exit(1);
});


require("dotenv").config();
const express = require("express");

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

const app = express();

/**
 * ENV
 * BOT_TOKEN
 * CLIENT_ID
 * CLIENT_SECRET
 * GUILD_ID
 * RESERVE_ROLE_ID
 * BASE_URL    (예: https://raon-oauth-bot.onrender.com)
 * SITE_URL    (예: https://line-taupe-seven.vercel.app/)
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

/* =========================================================
   ✅ CORS 허용 (사이트에서 /api/reserve-count 읽기 위해 필수)
========================================================= */
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

/* =========================================================
   ✅ 디스코드 클라이언트 (disallowed intents 방지)
========================================================= */
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

/* =========================================================
   Slash Command Deploy (관리자만)
========================================================= */
async function deployCommands() {
  const cmd = new SlashCommandBuilder()
    .setName("사전예약")
    .setDescription("라온서버 사전예약 버튼을 띄웁니다.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild) // ✅ 관리자만
    .setDMPermission(false);

  const rest = new REST({ version: "10" }).setToken(BOT_TOKEN);

  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
    body: [cmd.toJSON()]
  });

  console.log("✅ Slash command deployed: /사전예약 (ManageGuild only)");
}

/* =========================================================
   /사전예약 -> 임베드 + 사이트 링크 버튼
========================================================= */
client.on("interactionCreate", async (interaction) => {
  try {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== "사전예약") return;

    // ✅ 이중 방어(혹시 퍼미션 반영 전에도 막기)
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({
        content: "❌ 이 명령어는 관리자만 사용할 수 있습니다.",
        ephemeral: true
      });
    }

    const embed = new EmbedBuilder()
      .setTitle("📌 라온서버 사전예약")
      .setDescription(
        "아래 버튼을 눌러 사전예약 페이지로 이동하세요.\n" +
          "사이트에서 사전예약을 완료하면 디스코드 역할이 자동 지급됩니다."
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
      await interaction
        .reply({ content: "오류가 발생했습니다. 관리자에게 문의하세요.", ephemeral: true })
        .catch(() => {});
    }
  }
});

/* =========================================================
   ✅ API: 사전예약 인원수 (역할 가진 사람 수)
   GET /api/reserve-count  -> { count: number }
========================================================= */
app.get("/api/reserve-count", async (req, res) => {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const role = await guild.roles.fetch(RESERVE_ROLE_ID);
    const count = role?.members?.size ?? 0;
    return res.json({ count });
  } catch (e) {
    console.error("❌ reserve-count error:", e);
    return res.status(500).json({ count: 0, error: "server_error" });
  }
});

/* =========================================================
   OAuth2 시작
   GET /auth/discord
========================================================= */
app.get("/auth/discord", (req, res) => {
  const redirectUri = encodeURIComponent(`${BASE_URL}/auth/discord/callback`);

  // ✅ identify만으로 유저 id 얻기
  const scope = encodeURIComponent("identify");

  const url =
    "https://discord.com/api/oauth2/authorize" +
    `?client_id=${CLIENT_ID}` +
    `&redirect_uri=${redirectUri}` +
    `&response_type=code` +
    `&scope=${scope}`;

  return res.redirect(url);
});

/* =========================================================
   OAuth2 콜백
   GET /auth/discord/callback
========================================================= */
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
        code,
        redirect_uri: `${BASE_URL}/auth/discord/callback`
      })
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      console.error("❌ tokenData:", tokenData);
      throw new Error("Failed to get access_token");
    }

    // 2) token -> user
    const userRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });

    const user = await userRes.json();
    if (!user?.id) {
      console.error("❌ user:", user);
      throw new Error("Failed to fetch user");
    }

    // 3) 멤버 확인 (서버에 있어야 역할 지급 가능)
    const guild = await client.guilds.fetch(GUILD_ID);
    const member = await guild.members.fetch(user.id).catch(() => null);

    const okUrl = SUCCESS_REDIRECT || SITE_URL;
    const failUrl = FAIL_REDIRECT || SITE_URL;

    if (!member) {
      return res.redirect(`${failUrl}?reason=not_in_guild`);
    }

    // ✅ 이미 역할 있으면 already=1
    if (member.roles.cache.has(RESERVE_ROLE_ID)) {
      return res.redirect(`${okUrl}?already=1`);
    }

    // ✅ 역할 지급
    await member.roles.add(RESERVE_ROLE_ID, "사전예약 완료 역할 지급");

    return res.redirect(`${okUrl}?ok=1`);
  } catch (err) {
    console.error("❌ OAuth callback error:", err);
    const failUrl = FAIL_REDIRECT || SITE_URL;
    return res.redirect(`${failUrl}?ok=0`);
  }
});

/* =========================================================
   Health Check
========================================================= */
app.get("/", (req, res) => res.send("OK"));

/* =========================================================
   Run
========================================================= */
const PORT = process.env.PORT || 3000;

(async () => {
  await client.login(BOT_TOKEN);
  console.log(`✅ Bot logged in: ${client.user.tag}`);

  await deployCommands();

  app.listen(PORT, () => {
    console.log(`✅ Web running on port ${PORT}`);
    console.log(`- OAuth start: ${BASE_URL}/auth/discord`);
    console.log(`- Callback:   ${BASE_URL}/auth/discord/callback`);
    console.log(`- Count API:  ${BASE_URL}/api/reserve-count`);
  });
})().catch((e) => {
  console.error("❌ FATAL:", e);
  process.exit(1);
});

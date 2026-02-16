require("dotenv").config();
const express = require("express");

const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

const app = express();

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

function need(v, name) { if (!v) throw new Error(`Missing env: ${name}`); }
[
  ["BOT_TOKEN", BOT_TOKEN],
  ["CLIENT_ID", CLIENT_ID],
  ["CLIENT_SECRET", CLIENT_SECRET],
  ["GUILD_ID", GUILD_ID],
  ["RESERVE_ROLE_ID", RESERVE_ROLE_ID],
  ["BASE_URL", BASE_URL],
  ["SITE_URL", SITE_URL]
].forEach(([n, v]) => need(v, n));

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.GuildMember]
});

async function deployCommands() {
  const cmd = new SlashCommandBuilder()
    .setName("사전예약")
    .setDescription("라온서버 사전예약 버튼을 띄웁니다.");

  const rest = new REST({ version: "10" }).setToken(BOT_TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: [cmd.toJSON()] }
  );
  console.log("✅ Slash command deployed: /사전예약");
}

client.on("interactionCreate", async (interaction) => {
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
});

app.get("/auth/discord", (req, res) => {
  const redirectUri = encodeURIComponent(`${BASE_URL}/auth/discord/callback`);
  const scope = encodeURIComponent("identify");

  const url =
    "https://discord.com/api/oauth2/authorize" +
    `?client_id=${CLIENT_ID}` +
    `&redirect_uri=${redirectUri}` +
    `&response_type=code` +
    `&scope=${scope}`;

  return res.redirect(url);
});

app.get("/auth/discord/callback", async (req, res) => {
  try {
    const code = req.query.code;
    if (!code) throw new Error("No code in callback");

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

    const userRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const user = await userRes.json();
    if (!user || !user.id) throw new Error("Failed to fetch user");

    const guild = await client.guilds.fetch(GUILD_ID);
    const member = await guild.members.fetch(user.id).catch(() => null);

    if (!member) {
      const fail = FAIL_REDIRECT || SITE_URL;
      return res.redirect(`${fail}?reason=not_in_guild`);
    }

    if (!member.roles.cache.has(RESERVE_ROLE_ID)) {
      await member.roles.add(RESERVE_ROLE_ID, "사전예약 완료 역할 지급");
    }

    const ok = SUCCESS_REDIRECT || SITE_URL;
    return res.redirect(`${ok}?ok=1`);
  } catch (err) {
    console.error("❌ OAuth callback error:", err);
    const fail = FAIL_REDIRECT || SITE_URL;
    return res.redirect(`${fail}?ok=0`);
  }
});

app.get("/", (req, res) => res.send("OK"));

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
})();

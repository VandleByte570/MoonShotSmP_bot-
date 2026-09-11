require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits
} = require("discord.js");

const {
  token,
  falixKey,
  serverId
} = require("./config");

// =====================================================
// RENDER HTTP SERVER
// =====================================================

const http = require("http");

const PORT = process.env.PORT || 10000;

http.createServer((req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/plain"
  });

  res.end("MoonShotSMP Bot is online!");
}).listen(PORT, () => {
  console.log(`🌐 HTTP server running on port ${PORT}`);
});

// =====================================================
// CONFIG
// =====================================================

const FALIX_API =
  "https://client.falixnodes.net/api/v2";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds
  ]
});

// =====================================================
// FALIX API REQUEST
// =====================================================

async function falixRequest(endpoint, options = {}) {
  const response = await fetch(
    `${FALIX_API}${endpoint}`,
    {
      ...options,

      headers: {
        "Authorization": `Bearer ${falixKey}`,
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    }
  );

  let data = {};

  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    const error = new Error(
      data?.error?.message ||
      `Falix API Error: ${response.status}`
    );

    error.code = data?.error?.code;
    error.actionUrl = data?.error?.action_url;

    throw error;
  }

  return data;
}

// =====================================================
// GET SERVER INFORMATION
// =====================================================

async function getServerInfo() {
  const response = await falixRequest(
    `/servers/${encodeURIComponent(serverId)}`
  );

  return response.data || {};
}

// =====================================================
// GET SERVER STATUS
// =====================================================

async function getServerStatus() {
  const response = await falixRequest(
    `/servers/${encodeURIComponent(serverId)}/status`
  );

  return response.data || {};
}

// =====================================================
// POWER SERVER
// =====================================================

async function powerServer(action) {
  if (
    !["start", "stop", "restart"].includes(action)
  ) {
    throw new Error("Invalid server action.");
  }

  return falixRequest(
    `/servers/${encodeURIComponent(serverId)}/power`,
    {
      method: "POST",

      headers: {
        "Idempotency-Key":
          `${serverId}-${action}-${Date.now()}`
      },

      body: JSON.stringify({
        signal: action
      })
    }
  );
}

// =====================================================
// FORMAT UPTIME
// =====================================================

function formatUptime(seconds) {
  if (
    seconds === undefined ||
    seconds === null
  ) {
    return "N/A";
  }

  seconds = Math.floor(Number(seconds));

  if (Number.isNaN(seconds)) {
    return "N/A";
  }

  const days =
    Math.floor(seconds / 86400);

  seconds %= 86400;

  const hours =
    Math.floor(seconds / 3600);

  seconds %= 3600;

  const minutes =
    Math.floor(seconds / 60);

  const secs =
    seconds % 60;

  const parts = [];

  if (days > 0) {
    parts.push(`${days}d`);
  }

  if (hours > 0) {
    parts.push(`${hours}h`);
  }

  if (minutes > 0) {
    parts.push(`${minutes}m`);
  }

  if (
    parts.length === 0 ||
    secs > 0
  ) {
    parts.push(`${secs}s`);
  }

  return parts.join(" ");
}

// =====================================================
// GET VALUE SAFELY
// =====================================================

function getValue(
  object,
  paths,
  fallback = "N/A"
) {
  for (const path of paths) {
    const parts = path.split(".");

    let value = object;

    for (const part of parts) {
      if (
        value === undefined ||
        value === null
      ) {
        value = undefined;
        break;
      }

      value = value[part];
    }

    if (
      value !== undefined &&
      value !== null &&
      value !== ""
    ) {
      return value;
    }
  }

  return fallback;
}

// =====================================================
// SERVER STATE
// =====================================================

function getServerState(status) {
  const state = String(
    getValue(
      status,
      [
        "state",
        "status",
        "server_state"
      ],
      "offline"
    )
  ).toLowerCase();

  if (
    state === "online" ||
    state === "running"
  ) {
    return {
      emoji: "🟢",
      text: "ONLINE",
      color: 0x57F287
    };
  }

  if (
    state === "starting" ||
    state === "booting" ||
    state === "queued"
  ) {
    return {
      emoji: "🟡",
      text: "STARTING",
      color: 0xFEE75C
    };
  }

  if (
    state === "stopping"
  ) {
    return {
      emoji: "🟠",
      text: "STOPPING",
      color: 0xFEE75C
    };
  }

  return {
    emoji: "🔴",
    text: "OFFLINE",
    color: 0xED4245
  };
}

// =====================================================
// PLAYER COUNT
// =====================================================

function getPlayerCount(
  status,
  server
) {
  const online = getValue(
    status,
    [
      "players.online",
      "players.current",
      "player_count",
      "players"
    ],
    null
  );

  const max = getValue(
    status,
    [
      "players.max",
      "players.maximum",
      "max_players"
    ],
    getValue(
      server,
      [
        "players.max",
        "max_players"
      ],
      null
    )
  );

  if (
    typeof online === "number" &&
    typeof max === "number"
  ) {
    return `${online} / ${max}`;
  }

  if (online !== null) {
    return String(online);
  }

  return "N/A";
}

// =====================================================
// BUILD PANEL
// =====================================================

async function buildPanel() {
  const [
    server,
    status
  ] = await Promise.all([
    getServerInfo(),
    getServerStatus()
  ]);

  const state =
    getServerState(status);

  const serverName =
    getValue(
      server,
      [
        "name",
        "server_name"
      ],
      "Minecraft Server"
    );

  const version =
    getValue(
      server,
      [
        "version",
        "game.version",
        "software.version",
        "application.version"
      ],
      "N/A"
    );

  const address =
    getValue(
      server,
      [
        "address",
        "connection.address",
        "allocation.address",
        "primary_allocation.address"
      ],
      "N/A"
    );

  const uptime =
    getValue(
      status,
      [
        "uptime",
        "uptime_seconds"
      ],
      null
    );

  let uptimeText = "N/A";

  if (
    state.text === "ONLINE"
  ) {
    uptimeText =
      formatUptime(uptime);
  }

  if (
    state.text === "STARTING"
  ) {
    uptimeText =
      "Server is starting...";
  }

  if (
    state.text === "STOPPING"
  ) {
    uptimeText =
      "Server is stopping...";
  }

  if (
    state.text === "OFFLINE"
  ) {
    uptimeText =
      "Server is offline";
  }

  // ===================================================
  // EMBED
  // ===================================================

  const embed =
    new EmbedBuilder()
      .setColor(state.color)

      .setTitle(
        `🚀 ${serverName} Server Control Panel`
      )

      .setDescription(
        `${state.emoji} **${state.text}**`
      )

      .addFields(
        {
          name: "👥 Player Count",
          value:
            `**${getPlayerCount(
              status,
              server
            )}**`,
          inline: true
        },

        {
          name: "🎮 Version",
          value:
            `**${version}**`,
          inline: true
        },

        {
          name: "⏱️ Uptime",
          value:
            `**${uptimeText}**`,
          inline: false
        },

        {
          name:
            "🌐 Connection Address (IP:Port)",
          value:
            `\`${address}\``,
          inline: false
        }
      )

      .setFooter({
        text:
          "Falix Minecraft Server Manager"
      })

      .setTimestamp();

  // ===================================================
  // BUTTONS
  // ===================================================

  const row =
    new ActionRowBuilder()
      .addComponents(

        new ButtonBuilder()
          .setCustomId(
            "minecraft_start"
          )
          .setLabel("Start")
          .setEmoji("▶️")
          .setStyle(
            ButtonStyle.Success
          ),

        new ButtonBuilder()
          .setCustomId(
            "minecraft_stop"
          )
          .setLabel("Stop")
          .setEmoji("⏹️")
          .setStyle(
            ButtonStyle.Danger
          ),

        new ButtonBuilder()
          .setCustomId(
            "minecraft_restart"
          )
          .setLabel("Restart")
          .setEmoji("🔄")
          .setStyle(
            ButtonStyle.Primary
          ),

        new ButtonBuilder()
          .setCustomId(
            "minecraft_refresh"
          )
          .setLabel("Refresh")
          .setEmoji("🔃")
          .setStyle(
            ButtonStyle.Secondary
          )
      );

  return {
    embeds: [embed],
    components: [row]
  };
}

// =====================================================
// REGISTER /PANEL COMMAND
// =====================================================

async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName("panel")
      .setDescription(
        "Show the Minecraft server control panel"
      )
      .setDefaultMemberPermissions(
        PermissionFlagsBits.ManageGuild.toString()
      )
      .toJSON()
  ];

  const rest =
    new REST({
      version: "10"
    }).setToken(token);

  await rest.put(
    Routes.applicationCommands(
      client.user.id
    ),
    {
      body: commands
    }
  );

  console.log(
    "✅ /panel command registered."
  );
}

// =====================================================
// READY
// =====================================================

client.once(
  "clientReady",
  async () => {

    console.log(
      "================================"
    );

    console.log(
      `🤖 Logged in as ${client.user.tag}`
    );

    console.log(
      `🎮 Server ID: ${serverId}`
    );

    console.log(
      "🔐 Falix API: Connected"
    );

    console.log(
      "================================"
    );

    try {
      await registerCommands();
    } catch (error) {
      console.error(
        "❌ Command registration failed:",
        error
      );
    }
  }
);

// =====================================================
// INTERACTIONS
// =====================================================

client.on(
  "interactionCreate",
  async interaction => {

    // =================================================
    // /panel
    // =================================================

    if (
      interaction.isChatInputCommand()
    ) {

      if (
        interaction.commandName !==
        "panel"
      ) {
        return;
      }

      await interaction.deferReply();

      try {

        const panel =
          await buildPanel();

        await interaction.editReply(
          panel
        );

      } catch (error) {

        console.error(
          "Panel error:",
          error
        );

        await interaction.editReply({
          content:
            "❌ **Failed to load server information from Falix.**"
        });
      }

      return;
    }

    // =================================================
    // BUTTONS
    // =================================================

    if (
      !interaction.isButton()
    ) {
      return;
    }

    // =================================================
    // REFRESH
    // =================================================

    if (
      interaction.customId ===
      "minecraft_refresh"
    ) {

      await interaction.deferUpdate();

      try {

        const panel =
          await buildPanel();

        await interaction.message.edit(
          panel
        );

      } catch (error) {

        console.error(
          "Refresh error:",
          error
        );
      }

      return;
    }

    // =================================================
    // POWER ACTION
    // =================================================

    const actions = {
      minecraft_start:
        "start",

      minecraft_stop:
        "stop",

      minecraft_restart:
        "restart"
    };

    const action =
      actions[
        interaction.customId
      ];

    if (!action) {
      return;
    }

    await interaction.deferReply({
      ephemeral: true
    });

    try {

      await powerServer(action);

      await interaction.editReply({
        content:
          `✅ **${action.toUpperCase()}** request sent to Falix.\n\n` +
          `⏳ Server status will update shortly.`
      });

      // Refresh panel after Falix
      // has had time to process request.

      setTimeout(
        async () => {

          try {

            const panel =
              await buildPanel();

            await interaction.message.edit(
              panel
            );

          } catch (error) {

            console.error(
              "Automatic panel refresh failed:",
              error
            );
          }

        },
        4000
      );

    } catch (error) {

      console.error(
        `Failed to ${action} server:`,
        error
      );

      let message =
        `❌ Failed to **${action}** the server.`;

      if (
        error.code ===
        "ad_required"
      ) {

        message =
          "⚠️ Falix requires an action before this server can be started.";

        if (error.actionUrl) {

          message +=
            `\nAction URL: ${error.actionUrl}`;
        }
      }

      if (
        error.code ===
        "forbidden"
      ) {

        message =
          "🔒 Your Falix API key does not have permission for this action.";
      }

      if (
        error.code ===
        "not_found"
      ) {

        message =
          "❌ Falix server was not found. Check your FALIX_SERVER_ID.";
      }

      if (
        error.code ===
        "rate_limit_exceeded"
      ) {

        message =
          "⏳ Falix API rate limit reached. Try again later.";
      }

      await interaction.editReply({
        content: message
      });
    }
  }
);

// =====================================================
// ERROR HANDLING
// =====================================================

client.on(
  "error",
  error => {
    console.error(
      "Discord error:",
      error
    );
  }
);

process.on(
  "unhandledRejection",
  error => {
    console.error(
      "Unhandled rejection:",
      error
    );
  }
);

process.on(
  "uncaughtException",
  error => {
    console.error(
      "Uncaught exception:",
      error
    );
  }
);

// =====================================================
// LOGIN
// =====================================================

client.login(token);

require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events,
  PermissionFlagsBits
} = require("discord.js");

// ======================================================
// CONFIG
// ======================================================

const {
  DISCORD_TOKEN,
  DISCORD_CLIENT_ID,
  DISCORD_GUILD_ID,
  FALIX_API_KEY,
  FALIX_SERVER_ID
} = process.env;

const FALIX_BASE =
  "https://client.falixnodes.net/api/v2";

const REFRESH_INTERVAL = 15000;

// ======================================================
// ENV CHECK
// ======================================================

const required = {
  DISCORD_TOKEN,
  DISCORD_CLIENT_ID,
  DISCORD_GUILD_ID,
  FALIX_API_KEY,
  FALIX_SERVER_ID
};

const missing = Object.entries(required)
  .filter(([, value]) => !value)
  .map(([key]) => key);

if (missing.length > 0) {
  console.error(
    `Missing environment variables: ${missing.join(", ")}`
  );
  process.exit(1);
}

// ======================================================
// DISCORD CLIENT
// ======================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds
  ]
});

// ======================================================
// FALIX API
// ======================================================

async function falixRequest(path, options = {}) {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, 15000);

  try {
    const response = await fetch(
      `${FALIX_BASE}${path}`,
      {
        ...options,
        signal: controller.signal,
        headers: {
          "Authorization": `Bearer ${FALIX_API_KEY}`,
          "Content-Type": "application/json",
          ...(options.headers || {})
        }
      }
    );

    let body = {};

    try {
      body = await response.json();
    } catch {
      body = {};
    }

    if (!response.ok) {
      const error = body?.error || {};

      const err = new Error(
        error.message ||
        `Falix API returned HTTP ${response.status}`
      );

      err.status = response.status;
      err.code = error.code;
      err.actionUrl = error.action_url;
      err.requestId =
        error.request_id ||
        response.headers.get("x-request-id");

      throw err;
    }

    return body;
  } finally {
    clearTimeout(timeout);
  }
}

// ======================================================
// FALIX SERVER FUNCTIONS
// ======================================================

async function getServer() {
  const response = await falixRequest(
    `/servers/${encodeURIComponent(FALIX_SERVER_ID)}`
  );

  return response.data;
}

async function getServerStatus() {
  const response = await falixRequest(
    `/servers/${encodeURIComponent(FALIX_SERVER_ID)}/status`
  );

  return response.data;
}

async function getQueueStatus() {
  const response = await falixRequest(
    `/servers/${encodeURIComponent(FALIX_SERVER_ID)}/console/queue-status`
  );

  return response.data;
}

async function powerServer(signal) {
  if (!["start", "stop", "restart"].includes(signal)) {
    throw new Error("Invalid power signal.");
  }

  const response = await falixRequest(
    `/servers/${encodeURIComponent(FALIX_SERVER_ID)}/power`,
    {
      method: "POST",
      headers: {
        // Prevent accidental duplicate execution on retries.
        "Idempotency-Key":
          `${FALIX_SERVER_ID}-${signal}-${Date.now()}`
      },
      body: JSON.stringify({
        signal
      })
    }
  );

  return response.data;
}

// ======================================================
// HELPERS
// ======================================================

function pick(obj, paths, fallback = null) {
  for (const path of paths) {
    const parts = path.split(".");
    let value = obj;

    for (const part of parts) {
      if (
        value === null ||
        value === undefined
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

function formatDuration(seconds) {
  if (
    seconds === null ||
    seconds === undefined ||
    Number.isNaN(Number(seconds))
  ) {
    return "N/A";
  }

  let total = Math.max(0, Math.floor(Number(seconds)));

  const days = Math.floor(total / 86400);
  total %= 86400;

  const hours = Math.floor(total / 3600);
  total %= 3600;

  const minutes = Math.floor(total / 60);
  const secs = total % 60;

  const parts = [];

  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);

  if (!days && !hours && !minutes) {
    parts.push(`${secs}s`);
  }

  return parts.join(" ");
}

function formatPlayers(status, server) {
  const online = pick(status, [
    "players.online",
    "players.current",
    "player_count",
    "players"
  ]);

  const max = pick(status, [
    "players.max",
    "players.maximum",
    "max_players"
  ], pick(server, [
    "players.max",
    "max_players"
  ]));

  if (
    typeof online === "number" &&
    typeof max === "number"
  ) {
    return `${online} / ${max}`;
  }

  if (typeof online === "number") {
    return String(online);
  }

  return "N/A";
}

function getState(status) {
  const state = String(
    pick(status, [
      "state",
      "status",
      "server_state"
    ], "offline")
  ).toLowerCase();

  return state;
}

function stateDisplay(state) {
  switch (state) {
    case "online":
    case "running":
      return {
        emoji: "🟢",
        text: "ONLINE"
      };

    case "starting":
    case "booting":
    case "installing":
    case "queued":
      return {
        emoji: "🟡",
        text: "STARTING"
      };

    case "stopping":
    case "stopped":
      return {
        emoji: "🟠",
        text: "STOPPING"
      };

    case "offline":
    case "stopped":
    default:
      return {
        emoji: "🔴",
        text: "OFFLINE"
      };
  }
}

// ======================================================
// PANEL
// ======================================================

async function buildPanel() {
  const [server, status] = await Promise.all([
    getServer(),
    getServerStatus()
  ]);

  const state = getState(status);
  const display = stateDisplay(state);

  const serverName = pick(server, [
    "name",
    "server_name"
  ], "Minecraft Server");

  const version = pick(server, [
    "version",
    "game.version",
    "software.version",
    "application.version"
  ], "N/A");

  const address = pick(server, [
    "address",
    "connection.address",
    "allocation.address",
    "primary_allocation.address"
  ], "N/A");

  const uptime = pick(status, [
    "uptime",
    "uptime_seconds"
  ]);

  let timeInfo = "N/A";

  if (
    state === "online" ||
    state === "running"
  ) {
    timeInfo = formatDuration(uptime);
  } else if (
    state === "starting" ||
    state === "booting" ||
    state === "queued"
  ) {
    try {
      const queue = await getQueueStatus();

      const estimatedWait = pick(queue, [
        "estimated_wait_seconds",
        "estimated_wait",
        "wait_seconds"
      ]);

      const position = pick(queue, [
        "position",
        "queue_position"
      ]);

      if (estimatedWait !== null) {
        timeInfo =
          `~${formatDuration(estimatedWait)} remaining`;
      } else if (position !== null) {
        timeInfo =
          `Queue position: ${position}`;
      } else {
        timeInfo = "Starting...";
      }
    } catch {
      timeInfo = "Starting...";
    }
  } else {
    timeInfo = "Server is offline";
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`🚀 ${serverName} Control Panel`)
    .addFields(
      {
        name: "Server Status",
        value: `${display.emoji} **${display.text}**`,
        inline: false
      },
      {
        name: "Player Count",
        value: formatPlayers(status, server),
        inline: true
      },
      {
        name: "Version",
        value: String(version),
        inline: true
      },
      {
        name: "Uptime / Startup Time",
        value: timeInfo,
        inline: false
      },
      {
        name: "Connection Address",
        value: `\`${address}\``,
        inline: false
      }
    )
    .setFooter({
      text: "Falix Server Manager"
    })
    .setTimestamp();

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("server_start")
      .setLabel("Start")
      .setEmoji("▶️")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId("server_stop")
      .setLabel("Stop")
      .setEmoji("⏹️")
      .setStyle(ButtonStyle.Danger),

    new ButtonBuilder()
      .setCustomId("server_restart")
      .setLabel("Restart")
      .setEmoji("🔄")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId("server_refresh")
      .setLabel("Refresh")
      .setEmoji("🔃")
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    embeds: [embed],
    components: [buttons]
  };
}

// ======================================================
// PANEL REFRESH
// ======================================================

async function refreshMessage(message) {
  try {
    const panel = await buildPanel();

    await message.edit(panel);

    return true;
  } catch (error) {
    console.error(
      "Panel refresh error:",
      error.message
    );

    return false;
  }
}

// ======================================================
// SLASH COMMAND REGISTRATION
// ======================================================

async function registerCommand() {
  const guild = await client.guilds.fetch(
    DISCORD_GUILD_ID
  );

  await guild.commands.set([
    {
      name: "panel",
      description:
        "Show the Minecraft server control panel",
      defaultMemberPermissions:
        PermissionFlagsBits.ManageGuild.toString()
    }
  ]);

  console.log(
    `Registered /panel in ${guild.name}`
  );
}

// ======================================================
// READY
// ======================================================

client.once(Events.ClientReady, async (readyClient) => {
  console.log(
    `🤖 Logged in as ${readyClient.user.tag}`
  );

  try {
    await registerCommand();
  } catch (error) {
    console.error(
      "Command registration failed:",
      error
    );
  }
});

// ======================================================
// INTERACTIONS
// ======================================================

client.on(
  Events.InteractionCreate,
  async (interaction) => {

    // ------------------------------
    // /panel
    // ------------------------------

    if (interaction.isChatInputCommand()) {
      if (interaction.commandName !== "panel") {
        return;
      }

      if (
        !interaction.memberPermissions?.has(
          PermissionFlagsBits.ManageGuild
        )
      ) {
        return interaction.reply({
          content:
            "❌ You don't have permission to use this panel.",
          ephemeral: true
        });
      }

      await interaction.deferReply();

      try {
        const panel = await buildPanel();

        await interaction.editReply(panel);
      } catch (error) {
        console.error(
          "Panel creation error:",
          error
        );

        await interaction.editReply({
          content:
            "❌ Failed to load the Falix server status."
        });
      }

      return;
    }

    // ------------------------------
    // Buttons
    // ------------------------------

    if (!interaction.isButton()) {
      return;
    }

    if (
      !interaction.memberPermissions?.has(
        PermissionFlagsBits.ManageGuild
      )
    ) {
      return interaction.reply({
        content:
          "❌ You don't have permission to control this server.",
        ephemeral: true
      });
    }

    // ------------------------------
    // Refresh
    // ------------------------------

    if (
      interaction.customId === "server_refresh"
    ) {
      await interaction.deferUpdate();

      await refreshMessage(interaction.message);

      return;
    }

    // ------------------------------
    // Power buttons
    // ------------------------------

    const signals = {
      server_start: "start",
      server_stop: "stop",
      server_restart: "restart"
    };

    const signal =
      signals[interaction.customId];

    if (!signal) {
      return;
    }

    await interaction.deferReply({
      ephemeral: true
    });

    try {
      await powerServer(signal);

      const names = {
        start: "started",
        stop: "stopped",
        restart: "restarted"
      };

      await interaction.editReply({
        content:
          `✅ **${signal.toUpperCase()}** request sent to Falix.\n` +
          `The server action has been queued.`
      });

      // Give Falix a moment to update its status.
      setTimeout(async () => {
        await refreshMessage(
          interaction.message
        );
      }, 3000);

    } catch (error) {
      console.error(
        `Power action (${signal}) failed:`,
        error
      );

      let message =
        "❌ Falix rejected the request.";

      if (error.code === "ad_required") {
        message =
          "⚠️ Falix requires an action before this server can start.";
        
        if (error.actionUrl) {
          message +=
            `\nOpen the Falix action page: ${error.actionUrl}`;
        }
      } else if (
        error.code === "rate_limit_exceeded"
      ) {
        message =
          "⏳ Falix rate limit reached. Try again shortly.";
      } else if (
        error.code === "forbidden"
      ) {
        message =
          "🔒 Falix API key does not have the required permission.";
      } else if (
        error.code === "not_found"
      ) {
        message =
          "❌ Falix server ID was not found.";
      } else if (
        error.code === "conflict"
      ) {
        message =
          "⚠️ Another server action is already running.";
      } else if (error.message) {
        message =
          `❌ ${error.message}`;
      }

      await interaction.editReply({
        content: message
      });
    }
  }
);

// ======================================================
// AUTOMATIC STATUS REFRESH
// ======================================================

setInterval(async () => {
  // We intentionally don't create a new message.
  // Existing panels are refreshed only when interacted with.
  //
  // This keeps API usage low and avoids unnecessary
  // requests against Falix's rate limit.
}, REFRESH_INTERVAL);

// ======================================================
// PROCESS ERROR HANDLING
// ======================================================

process.on("unhandledRejection", (error) => {
  console.error(
    "Unhandled promise rejection:",
    error
  );
});

process.on("uncaughtException", (error) => {
  console.error(
    "Uncaught exception:",
    error
  );
});

// ======================================================
// LOGIN
// ======================================================

client.login(DISCORD_TOKEN);

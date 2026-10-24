require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    REST, 
    Routes, 
    SlashCommandBuilder, 
    PermissionFlagsBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    ComponentType
} = require('discord.js');
const { DisTube } = require('distube');
const { SoundCloudPlugin } = require('@distube/soundcloud');
const ffmpeg = require('ffmpeg-static');
const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ==========================================
// 1. RENDER KEEP-ALIVE WEB SERVER
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.status(200).send('☁️ Ultimate SoundCloud Music Bot (24/7 Ready) is Alive on Render!');
});

app.listen(PORT, () => {
    console.log(`🌐 Web server listening on port ${PORT}`);
});

// ==========================================
// 2. DATABASE MANAGEMENT (PREFIX & 24/7)
// ==========================================
const PREFIX_FILE = path.join(__dirname, 'prefixes.json');
const MODE247_FILE = path.join(__dirname, '247.json');
const DEFAULT_PREFIX = '!';

let prefixes = {};
let stay247 = {};

if (fs.existsSync(PREFIX_FILE)) {
    try { prefixes = JSON.parse(fs.readFileSync(PREFIX_FILE, 'utf8')); } catch { prefixes = {}; }
}
if (fs.existsSync(MODE247_FILE)) {
    try { stay247 = JSON.parse(fs.readFileSync(MODE247_FILE, 'utf8')); } catch { stay247 = {}; }
}

function savePrefixes() {
    try { fs.writeFileSync(PREFIX_FILE, JSON.stringify(prefixes, null, 2)); } catch (e) { console.error(e); }
}

function save247() {
    try { fs.writeFileSync(MODE247_FILE, JSON.stringify(stay247, null, 2)); } catch (e) { console.error(e); }
}

function getPrefix(guildId) {
    return prefixes[guildId] || DEFAULT_PREFIX;
}

// Progress Bar Generator for NowPlaying
function createProgressBar(current, total, size = 15) {
    if (!total || total === 0) return '🔘' + '▬'.repeat(size);
    const percentage = Math.min(Math.max(current / total, 0), 1);
    const progress = Math.round(size * percentage);
    const emptyProgress = size - progress;
    return '▬'.repeat(progress) + '🔘' + '▬'.repeat(emptyProgress);
}

// ==========================================
// 3. DISCORD CLIENT & DISTUBE (SOUNDCLOUD ONLY)
// ==========================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const scPlugin = new SoundCloudPlugin();

// Custom FFmpeg Audio Filters (Phonk / Slowed+Reverb / 8D / Speed)
const customFilters = {
    "slowed": "asetrate=48000*0.85,aresample=48000,aecho=0.8:0.88:60:0.4",
    "spedup": "asetrate=48000*1.25,aresample=48000",
    "8d": "apulsator=hz=0.125",
    "subboost": "asubboost",
    "treble": "treble=g=5",
    "normalizer": "dynaudnorm=f=200"
};

const distube = new DisTube(client, {
    plugins: [scPlugin], // Strictly SoundCloud only!
    emitNewSongOnly: true,
    emitAddSongWhenCreatingQueue: false,
    emitAddListWhenCreatingQueue: false,
    joinNewVoiceChannel: true,
    customFilters: customFilters,
    ffmpeg: {
        path: ffmpeg
    }
});

// ==========================================
// 4. SLASH COMMANDS (/prefix, /reset prefix, /247, /help)
// ==========================================
const commands = [
    new SlashCommandBuilder()
        .setName('prefix')
        .setDescription('Configure the bot command prefix for this server')
        .addSubcommand(subcommand =>
            subcommand
                .setName('set')
                .setDescription('Set a new custom prefix (Default is !)')
                .addStringOption(option =>
                    option.setName('symbol')
                        .setDescription('The new prefix symbol (e.g., !, ?, $, sc!)')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('reset')
                .setDescription('Reset the prefix back to default (!)')
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    new SlashCommandBuilder()
        .setName('reset')
        .setDescription('Reset bot configurations back to default')
        .addSubcommand(subcommand =>
            subcommand
                .setName('prefix')
                .setDescription('Reset the server command prefix back to default (!)')
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    new SlashCommandBuilder()
        .setName('247')
        .setDescription('Toggle 24/7 mode to keep the bot in your voice channel permanently'),

    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Open the interactive command help menu')
].map(command => command.toJSON());

client.once('ready', async () => {
    console.log(`🤖 Logged in as ${client.user.tag}`);
    client.user.setActivity(`${DEFAULT_PREFIX}help | ${DEFAULT_PREFIX}play`, { type: 2 });

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('✅ Registered /prefix, /reset prefix, /247, and /help slash commands!');
    } catch (error) {
        console.error('❌ Slash Command Registration Error:', error);
    }

    // Auto-Rejoin 24/7 Voice Channels on Startup
    for (const [guildId, config] of Object.entries(stay247)) {
        if (config?.enabled && config?.voiceChannelId) {
            try {
                const guild = await client.guilds.fetch(guildId).catch(() => null);
                const voiceChannel = guild?.channels?.cache.get(config.voiceChannelId);
                if (voiceChannel) {
                    await distube.voices.join(voiceChannel);
                    console.log(`♾️ [24/7 Auto-Join] Connected to ${voiceChannel.name} in ${guild.name}`);
                }
            } catch (err) {
                console.error(`⚠️ Failed to auto-join 24/7 channel in ${guildId}:`, err.message);
            }
        }
    }
});

// ==========================================
// 5. VOICE STATE GUARD (24/7 PROTECTION)
// ==========================================
client.on('voiceStateUpdate', async (oldState, newState) => {
    const guildId = oldState.guild.id;
    const config = stay247[guildId];

    // If bot was disconnected while 24/7 is enabled, auto-rejoin
    if (config?.enabled && oldState.member?.id === client.user.id && oldState.channelId && !newState.channelId) {
        setTimeout(async () => {
            if (!stay247[guildId]?.enabled) return;
            try {
                const channel = oldState.guild.channels.cache.get(config.voiceChannelId);
                if (channel) await distube.voices.join(channel);
            } catch (err) {
                console.error('24/7 Reconnect Error:', err.message);
            }
        }, 2000);
        return;
    }

    // If everyone leaves and 24/7 is disabled, disconnect
    const botVoice = distube.voices.get(guildId);
    if (botVoice && botVoice.channel) {
        const members = botVoice.channel.members.filter(m => !m.user.bot);
        if (members.size === 0 && !stay247[guildId]?.enabled) {
            const queue = distube.getQueue(guildId);
            if (queue) await queue.stop();
            botVoice.leave();
        }
    }
});

// ==========================================
// 6. INTERACTIVE HELP MENU BUILDER
// ==========================================
function buildHelpMenu(guildId, category = 'overview') {
    const prefix = getPrefix(guildId);
    const is247 = stay247[guildId]?.enabled ? '🟢 ON' : '🔴 OFF';

    const embed = new EmbedBuilder()
        .setColor('#FF5500')
        .setFooter({ text: `SoundCloud-Only Engine • Server Prefix: ${prefix} • 24/7 Mode: ${is247}` });

    if (category === 'overview') {
        embed.setTitle('☁️ SoundCloud Music Bot — Full Help Menu')
            .setDescription(
                `Welcome! I stream high-quality music **exclusively from SoundCloud**.\n` +
                `> **Current Server Prefix:** \`${prefix}\` (Default: \`!\`)\n` +
                `> **Reset Prefix Anytime:** \`/reset prefix\` or \`/prefix reset\`\n` +
                `> **Change Prefix:** \`/prefix set symbol:<new_prefix>\`\n\n` +
                `👇 **Select a category from the dropdown menu below** or view the quick summary:`
            )
            .addFields(
                { name: '🎵 Core Playback (9)', value: `\`play\`, \`playtop\`, \`playskip\`, \`search\`, \`pause\`, \`resume\`, \`replay\`, \`stop\`, \`grab\``, inline: false },
                { name: '📜 Queue & Navigation (11)', value: `\`queue\`, \`nowplaying\`, \`skip\`, \`previous\`, \`skipto\`, \`move\`, \`remove\`, \`clear\`, \`shuffle\`, \`loop\`, \`autoplay\``, inline: false },
                { name: '⏩ Seeking & Volume (4)', value: `\`volume\`, \`seek\`, \`forward\`, \`rewind\``, inline: false },
                { name: '🎛️ Audio Filters & Phonk Presets (21)', value: `\`filter\`, \`bassboost\`, \`slowed\`, \`spedup\`, \`nightcore\`, \`vaporwave\`, \`8d\`, \`3d\`, \`echo\`, \`subboost\`...`, inline: false },
                { name: '⚙️ Voice, Prefix & Utility (7)', value: `\`247\`, \`join\`, \`leave\`, \`prefix\`, \`ping\`, \`stats\`, \`help\``, inline: false }
            );
    } else if (category === 'music') {
        embed.setTitle('🎵 Core Playback Commands')
            .setDescription(`Use \`${prefix}<command>\` in any text channel while inside a Voice Channel:`)
            .addFields(
                { name: `\`${prefix}play <song / URL>\` (Alias: \`p\`)`, value: `Play a song or playlist from SoundCloud (e.g. \`${prefix}play Montagem One More Game\`)` },
                { name: `\`${prefix}playtop <song / URL>\` (Alias: \`pt\`)`, value: 'Add a song to the very top of the queue (#1 next)' },
                { name: `\`${prefix}playskip <song / URL>\` (Alias: \`ps\`)`, value: 'Immediately skip the current track and play this song' },
                { name: `\`${prefix}search <query>\` (Alias: \`sc\`, \`find\`)`, value: 'Search SoundCloud and choose from the top 5 tracks via a dropdown menu' },
                { name: `\`${prefix}pause\` / \`${prefix}resume\` (Alias: \`r\`)`, value: 'Pause or resume the currently playing song' },
                { name: `\`${prefix}replay\` (Alias: \`restart\`)`, value: 'Restart the current song from 0:00' },
                { name: `\`${prefix}grab\` (Alias: \`save\`, \`dm\`)`, value: 'Send the currently playing SoundCloud track to your Direct Messages' },
                { name: `\`${prefix}stop\``, value: 'Stop playback and clear the queue (stays in VC if 24/7 mode is enabled)' }
            );
    } else if (category === 'queue') {
        embed.setTitle('📜 Queue, Seeking & Navigation Commands')
            .setDescription('Full control over your song queue and playback position:')
            .addFields(
                { name: `\`${prefix}queue [page]\` (Alias: \`q\`)`, value: 'Display the song queue with pagination (10 songs per page)' },
                { name: `\`${prefix}nowplaying\` (Alias: \`np\`)`, value: 'Show the current song with a live progress bar and details' },
                { name: `\`${prefix}skip\` (Alias: \`s\`, \`next\`)`, value: 'Skip to the next song in the queue' },
                { name: `\`${prefix}previous\` (Alias: \`prev\`, \`back\`)`, value: 'Play the previous song in history' },
                { name: `\`${prefix}skipto <position>\` (Alias: \`jump\`)`, value: 'Jump directly to a specific song number in the queue' },
                { name: `\`${prefix}move <from> <to>\` (Alias: \`mv\`)`, value: `Move a song from one queue position to another (e.g. \`${prefix}move 5 1\`)` },
                { name: `\`${prefix}remove <position>\` (Alias: \`rm\`, \`delete\`)`, value: 'Remove a specific song number from the queue' },
                { name: `\`${prefix}clear\` (Alias: \`cl\`, \`clearqueue\`)`, value: 'Clear all upcoming songs without stopping the current song' },
                { name: `\`${prefix}shuffle\` (Alias: \`mix\`)`, value: 'Randomly shuffle all songs in the queue' },
                { name: `\`${prefix}loop [off/song/queue]\` (Alias: \`repeat\`)`, value: 'Toggle repeat mode between Off, Single Song, or Full Queue' },
                { name: `\`${prefix}autoplay\` (Alias: \`ap\`)`, value: 'Automatically play related SoundCloud tracks when the queue ends' },
                { name: `\`${prefix}volume <1-150>\` (Alias: \`vol\`, \`v\`)`, value: 'Adjust playback volume between 1% and 150%' },
                { name: `\`${prefix}seek <seconds>\` / \`${prefix}forward <sec>\` / \`${prefix}rewind <sec>\``, value: 'Jump to a timestamp, fast-forward (`!ff 15`), or rewind (`!rw 15`)' }
            );
    } else if (category === 'filters') {
        embed.setTitle('🎛️ Audio Filters & Phonk Effects')
            .setDescription(`Apply real-time audio filters! You can use \`${prefix}filter <name>\` or type the filter name directly as a command:`)
            .addFields(
                { name: '🔥 Popular & Phonk Presets', value: `\`${prefix}bassboost\` (or \`${prefix}bb\`) — Heavy bass boost\n\`${prefix}slowed\` — Slowed + Reverb effect\n\`${prefix}spedup\` — Fast sped-up effect\n\`${prefix}nightcore\` — High pitch & fast tempo\n\`${prefix}vaporwave\` — Slow & low pitch aesthetic\n\`${prefix}8d\` — Rotating 8D spatial audio\n\`${prefix}subboost\` — Deep subwoofer boost` },
                { name: '🎧 Studio Effects', value: '`3d`, `echo`, `karaoke`, `flanger`, `gate`, `haas`, `reverse`, `surround`, `mcompand`, `phaser`, `tremolo`, `treble`, `normalizer`, `earwax`' },
                { name: '🧹 Clear All Filters', value: `Use \`${prefix}filter off\` or \`${prefix}filter clear\` to return audio to normal.` }
            );
    } else if (category === 'settings') {
        embed.setTitle('⚙️ Settings, 24/7 Mode & Utility Commands')
            .setDescription('Configure the bot for your server:')
            .addFields(
                { name: '🔧 Slash Commands', value: '`/prefix set symbol:<prefix>` — Change server prefix\n`/reset prefix` or `/prefix reset` — Reset prefix back to `!`\n`/247` — Toggle 24/7 stay-in-channel mode\n`/help` — Open this interactive help menu' },
                { name: `♾️ \`${prefix}247 [on/off]\` (Alias: \`24/7\`, \`stay\`)`, value: 'Keep the bot inside your voice channel 24/7 even when idle or alone' },
                { name: `📥 \`${prefix}join\` / \`${prefix}leave\` (Alias: \`dc\`)`, value: 'Summon the bot to your VC or force it to disconnect' },
                { name: `⚙️ \`${prefix}prefix <new_prefix / reset>\``, value: `Change prefix via text command or reset with \`${prefix}prefix reset\`` },
                { name: `📊 \`${prefix}ping\` / \`${prefix}stats\` / \`${prefix}uptime\``, value: 'View bot latency, memory usage, server count, and uptime' }
            );
    }

    const selectRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('help_category_select')
            .setPlaceholder('📂 Select a Command Category...')
            .addOptions([
                { label: 'Overview (All Commands)', value: 'overview', emoji: '🏠', description: 'Quick summary of all bot features' },
                { label: 'Core Playback', value: 'music', emoji: '🎵', description: 'Play, Playtop, Playskip, Search, Grab, Replay' },
                { label: 'Queue & Seeking', value: 'queue', emoji: '📜', description: 'Queue, Skip, Move, Remove, Clear, Shuffle, Loop, Seek' },
                { label: 'Audio Filters & Phonk', value: 'filters', emoji: '🎛️', description: 'Bassboost, Slowed+Reverb, Spedup, Nightcore, 8D' },
                { label: 'Settings, Prefix & 24/7', value: 'settings', emoji: '⚙️', description: '/reset prefix, /prefix set, 24/7 Mode, Stats, Ping' }
            ])
    );

    return { embeds: [embed], components: [selectRow] };
}

// ==========================================
// 7. INTERACTION HANDLER (SLASH, BUTTONS, MENUS)
// ==========================================
client.on('interactionCreate', async (interaction) => {
    try {
        // --- A. DROPDOWN MENU FOR HELP ---
        if (interaction.isStringSelectMenu() && interaction.customId === 'help_category_select') {
            const selected = interaction.values[0];
            const menuData = buildHelpMenu(interaction.guildId, selected);
            return await interaction.update(menuData);
        }

        // --- B. NOW PLAYING PLAYER BUTTONS ---
        if (interaction.isButton() && interaction.customId.startsWith('np_')) {
            const voiceChannel = interaction.member?.voice?.channel;
            const queue = distube.getQueue(interaction.guildId);

            if (!voiceChannel) {
                return interaction.reply({ content: '❌ Join a Voice Channel first to use player buttons!', ephemeral: true });
            }
            if (!queue) {
                return interaction.reply({ content: '❌ Nothing is playing right now.', ephemeral: true });
            }
            if (queue.voiceChannel.id !== voiceChannel.id) {
                return interaction.reply({ content: `❌ You must be in <#${queue.voiceChannel.id}> to control the music!`, ephemeral: true });
            }

            const action = interaction.customId.replace('np_', '');
            if (action === 'pause_resume') {
                if (queue.paused) {
                    queue.resume();
                    return interaction.reply({ content: `▶️ **${interaction.user.username}** resumed the music!` });
                } else {
                    queue.pause();
                    return interaction.reply({ content: `⏸️ **${interaction.user.username}** paused the music!` });
                }
            } else if (action === 'skip') {
                if (queue.songs.length <= 1 && !queue.autoplay) {
                    await queue.stop();
                    return interaction.reply({ content: `⏭️ **${interaction.user.username}** skipped the last track!` });
                }
                await queue.skip();
                return interaction.reply({ content: `⏭️ **${interaction.user.username}** skipped to the next song!` });
            } else if (action === 'stop') {
                await queue.stop();
                if (!stay247[interaction.guildId]?.enabled) {
                    distube.voices.get(interaction.guildId)?.leave();
                }
                return interaction.reply({ content: `🛑 **${interaction.user.username}** stopped the music and cleared the queue.` });
            } else if (action === 'loop') {
                const nextMode = (queue.repeatMode + 1) % 3;
                queue.setRepeatMode(nextMode);
                const modeText = nextMode === 2 ? '🔁 Queue Loop' : nextMode === 1 ? '🔂 Song Loop' : '➡️ Loop Off';
                return interaction.reply({ content: `**${interaction.user.username}** set loop mode to: **${modeText}**` });
            } else if (action === 'shuffle') {
                if (queue.songs.length < 3) {
                    return interaction.reply({ content: '❌ Need at least 3 songs in the queue to shuffle!', ephemeral: true });
                }
                await queue.shuffle();
                return interaction.reply({ content: `🔀 **${interaction.user.username}** shuffled the queue!` });
            }
        }

        // --- C. SLASH COMMANDS ---
        if (!interaction.isChatInputCommand()) return;

        // 1. /reset prefix
        if (interaction.commandName === 'reset') {
            if (interaction.options.getSubcommand() === 'prefix') {
                delete prefixes[interaction.guildId];
                savePrefixes();

                const embed = new EmbedBuilder()
                    .setColor('#00FF66')
                    .setTitle('✅ Prefix Reset to Default')
                    .setDescription(`The server prefix has been reset back to: \`${DEFAULT_PREFIX}\`\nExample: \`${DEFAULT_PREFIX}play Montagem One More Game\``);
                return interaction.reply({ embeds: [embed] });
            }
        }

        // 2. /prefix set & /prefix reset
        if (interaction.commandName === 'prefix') {
            const sub = interaction.options.getSubcommand();

            if (sub === 'set') {
                const newPrefix = interaction.options.getString('symbol').trim();
                if (newPrefix.length > 5) {
                    return interaction.reply({ content: '❌ Prefix cannot be longer than 5 characters!', ephemeral: true });
                }

                prefixes[interaction.guildId] = newPrefix;
                savePrefixes();

                const embed = new EmbedBuilder()
                    .setColor('#FF5500')
                    .setTitle('⚙️ Server Prefix Updated')
                    .setDescription(`Server prefix is now: \`${newPrefix}\`\nExample: \`${newPrefix}play Montagem One More Game\` or \`${newPrefix}help\`\n*(Use \`/reset prefix\` anytime to restore \`!\`)*`);
                return interaction.reply({ embeds: [embed] });
            }

            if (sub === 'reset') {
                delete prefixes[interaction.guildId];
                savePrefixes();
                return interaction.reply({ content: `✅ Server prefix has been reset back to default: \`${DEFAULT_PREFIX}\`` });
            }
        }

        // 3. /247
        if (interaction.commandName === '247') {
            const voiceChannel = interaction.member?.voice?.channel;
            if (!voiceChannel) {
                return interaction.reply({ content: '❌ You must be in a Voice Channel to toggle 24/7 mode!', ephemeral: true });
            }

            const current = stay247[interaction.guildId]?.enabled || false;
            if (!current) {
                stay247[interaction.guildId] = {
                    enabled: true,
                    voiceChannelId: voiceChannel.id,
                    textChannelId: interaction.channelId
                };
                save247();
                await distube.voices.join(voiceChannel);

                const embed = new EmbedBuilder()
                    .setColor('#00FF66')
                    .setTitle('♾️ 24/7 Mode: ENABLED')
                    .setDescription(`Locked into <#${voiceChannel.id}> **24/7**! I will stay even when the queue finishes or everyone leaves.`);
                return interaction.reply({ embeds: [embed] });
            } else {
                delete stay247[interaction.guildId];
                save247();

                const embed = new EmbedBuilder()
                    .setColor('#FF3333')
                    .setTitle('♾️ 24/7 Mode: DISABLED')
                    .setDescription('24/7 mode is now **OFF**.');
                return interaction.reply({ embeds: [embed] });
            }
        }

        // 4. /help
        if (interaction.commandName === 'help') {
            const menuData = buildHelpMenu(interaction.guildId, 'overview');
            return interaction.reply(menuData);
        }
    } catch (err) {
        console.error('Interaction Error:', err);
    }
});

// ==========================================
// 8. HELPER: SOUNDCLOUD-ONLY PLAY LOGIC
// ==========================================
async function handleSoundCloudPlay(message, voiceChannel, query, options = { position: 0, skip: false }) {
    const isUrl = /^https?:\/\//i.test(query);

    if (isUrl) {
        const isSoundCloudUrl = /^https?:\/\/(www\.|m\.|on\.)?soundcloud\.com\//i.test(query);
        if (!isSoundCloudUrl) {
            return message.reply('🚫 **SoundCloud Only!** Direct links from YouTube, Spotify, or other platforms are blocked. Please use a SoundCloud link or type the song title.');
        }

        const loadingMsg = await message.reply('☁️ Loading SoundCloud link...');
        await distube.play(voiceChannel, query, {
            member: message.member,
            textChannel: message.channel,
            message,
            position: options.position,
            skip: options.skip
        });
        loadingMsg.delete().catch(() => {});
    } else {
        const searchMsg = await message.reply(`🔍 Searching **SoundCloud** for: \`${query}\`...`);
        const results = await scPlugin.search(query, 'track', 1);

        if (!results || results.length === 0) {
            return searchMsg.edit(`❌ No results found on SoundCloud for \`${query}\`.`);
        }

        await distube.play(voiceChannel, results[0], {
            member: message.member,
            textChannel: message.channel,
            message,
            position: options.position,
            skip: options.skip
        });
        searchMsg.delete().catch(() => {});
    }
}

// ==========================================
// 9. PREFIX COMMAND HANDLER (ALL FEATURES)
// ==========================================
const allFilterNames = [
    'bassboost', 'slowed', 'spedup', 'nightcore', 'vaporwave', '8d', 'subboost', 'treble', 'normalizer',
    '3d', 'echo', 'karaoke', 'flanger', 'gate', 'haas', 'reverse', 'surround', 'mcompand', 'phaser', 'tremolo', 'earwax'
];

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    const prefix = getPrefix(message.guild.id);

    // Mentioning the bot shows current prefix & help tip
    if (message.content.trim() === `<@${client.user.id}>` || message.content.trim() === `<@!${client.user.id}>`) {
        return message.reply(
            `☁️ **SoundCloud Music Bot**\n` +
            `• **Current Prefix:** \`${prefix}\` (Reset anytime with \`/reset prefix\`)\n` +
            `• **Play Music:** \`${prefix}play Montagem One More Game\`\n` +
            `• **All Commands:** \`${prefix}help\` or \`/help\``
        );
    }

    if (!message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/g);
    const command = args.shift().toLowerCase();

    const voiceChannel = message.member?.voice?.channel;
    const queue = distube.getQueue(message.guildId);

    // Direct Filter Shortcut Support (e.g., !bassboost, !slowed, !nightcore, !8d)
    const filterAliases = { 'bb': 'bassboost', 'nc': 'nightcore', 'vw': 'vaporwave' };
    const resolvedFilter = filterAliases[command] || (allFilterNames.includes(command) ? command : null);

    const vcRequiredCommands = [
        'play', 'p', 'playtop', 'pt', 'playskip', 'ps', 'search', 'sc', 'find',
        '247', '24/7', 'stay', 'join', 'connect', 'skip', 's', 'next', 'stop',
        'leave', 'dc', 'disconnect', 'pause', 'resume', 'r', 'unpause',
        'replay', 'restart', 'loop', 'repeat', 'volume', 'vol', 'v', 'shuffle', 'mix',
        'seek', 'forward', 'ff', 'rewind', 'rw', 'filter', 'filters', 'fx',
        'autoplay', 'ap', 'previous', 'prev', 'back', 'remove', 'rm', 'delete',
        'move', 'mv', 'skipto', 'jump', 'clear', 'cl', 'clearqueue'
    ];

    if (vcRequiredCommands.includes(command) || resolvedFilter) {
        if (!voiceChannel) {
            return message.reply('❌ You must be in a **Voice Channel** to use music commands!');
        }
        if (queue && queue.voiceChannel.id !== voiceChannel.id) {
            return message.reply(`❌ You must be in the same Voice Channel as me (<#${queue.voiceChannel.id}>)!`);
        }
    }

    try {
        // If user typed a direct filter command like !bassboost or !slowed
        if (resolvedFilter) {
            if (!queue) return message.reply('❌ Nothing is playing right now.');
            if (queue.filters.has(resolvedFilter)) {
                queue.filters.remove(resolvedFilter);
                return message.reply(`🎛️ Disabled **${resolvedFilter}** filter.`);
            } else {
                queue.filters.add(resolvedFilter);
                return message.reply(`🎛️ Enabled **${resolvedFilter}** filter!`);
            }
        }

        switch (command) {
            // --- HELP COMMAND (!help) ---
            case 'help':
            case 'h':
            case 'commands': {
                const sub = args[0]?.toLowerCase();
                if (sub && ['music', 'queue', 'filters', 'settings'].includes(sub)) {
                    return message.reply(buildHelpMenu(message.guild.id, sub));
                }
                return message.reply(buildHelpMenu(message.guild.id, 'overview'));
            }

            // --- PREFIX COMMAND (!prefix set / !prefix reset / !resetprefix) ---
            case 'prefix':
            case 'setprefix':
            case 'resetprefix': {
                if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                    return message.reply('❌ You need the **Manage Server** permission to change the prefix!');
                }

                const arg = command === 'resetprefix' ? 'reset' : args[0];
                if (!arg) {
                    return message.reply(`⚙️ Current prefix is \`${prefix}\`.\n• Change: \`${prefix}prefix ?\` or \`/prefix set\`\n• Reset to \`!\`: \`${prefix}prefix reset\` or \`/reset prefix\``);
                }

                if (arg.toLowerCase() === 'reset') {
                    delete prefixes[message.guild.id];
                    savePrefixes();
                    return message.reply(`✅ Prefix has been reset back to default: \`${DEFAULT_PREFIX}\``);
                }

                if (arg.length > 5) {
                    return message.reply('❌ Prefix cannot be longer than 5 characters!');
                }

                prefixes[message.guild.id] = arg;
                savePrefixes();
                return message.reply(`✅ Server prefix updated to \`${arg}\`! Try \`${arg}play Montagem One More Game\`.`);
            }

            // --- 24/7 MODE (!247) ---
            case '247':
            case '24/7':
            case 'stay': {
                const subArg = args[0]?.toLowerCase();
                const isCurrentlyOn = stay247[message.guildId]?.enabled || false;

                let enableState = !isCurrentlyOn;
                if (subArg === 'on' || subArg === 'enable' || subArg === 'true') enableState = true;
                if (subArg === 'off' || subArg === 'disable' || subArg === 'false') enableState = false;

                if (enableState) {
                    stay247[message.guildId] = {
                        enabled: true,
                        voiceChannelId: voiceChannel.id,
                        textChannelId: message.channel.id
                    };
                    save247();
                    await distube.voices.join(voiceChannel);

                    const embed = new EmbedBuilder()
                        .setColor('#00FF66')
                        .setTitle('♾️ 24/7 Mode: ENABLED')
                        .setDescription(`Locked into <#${voiceChannel.id}> **24/7**!\nI won't leave when the queue finishes or when the channel is empty.`);
                    return message.reply({ embeds: [embed] });
                } else {
                    delete stay247[message.guildId];
                    save247();

                    const embed = new EmbedBuilder()
                        .setColor('#FF3333')
                        .setTitle('♾️ 24/7 Mode: DISABLED')
                        .setDescription(`24/7 mode is now **OFF**. Use \`${prefix}leave\` to disconnect me now.`);
                    return message.reply({ embeds: [embed] });
                }
            }

            // --- JOIN ---
            case 'join':
            case 'connect': {
                await distube.voices.join(voiceChannel);
                message.reply(`📥 Joined <#${voiceChannel.id}>!`);
                break;
            }

            // --- PLAY (!play) ---
            case 'play':
            case 'p': {
                const query = args.join(' ');
                if (!query) {
                    return message.reply(`❌ Provide a song name or SoundCloud URL!\nExample: \`${prefix}play Montagem One More Game\``);
                }
                await handleSoundCloudPlay(message, voiceChannel, query, { position: 0, skip: false });
                break;
            }

            // --- PLAYTOP (!playtop / !pt) ---
            case 'playtop':
            case 'pt': {
                const query = args.join(' ');
                if (!query) return message.reply(`❌ Usage: \`${prefix}playtop <song name or SoundCloud URL>\``);
                await handleSoundCloudPlay(message, voiceChannel, query, { position: 1, skip: false });
                break;
            }

            // --- PLAYSKIP (!playskip / !ps) ---
            case 'playskip':
            case 'ps': {
                const query = args.join(' ');
                if (!query) return message.reply(`❌ Usage: \`${prefix}playskip <song name or SoundCloud URL>\``);
                await handleSoundCloudPlay(message, voiceChannel, query, { position: 1, skip: true });
                break;
            }

            // --- INTERACTIVE SOUNDCLOUD SEARCH (!search / !sc) ---
            case 'search':
            case 'sc':
            case 'find': {
                const query = args.join(' ');
                if (!query) return message.reply(`❌ Usage: \`${prefix}search <song name>\``);

                const results = await scPlugin.search(query, 'track', 5);
                if (!results || results.length === 0) {
                    return message.reply(`❌ No SoundCloud tracks found for \`${query}\`.`);
                }

                const embed = new EmbedBuilder()
                    .setColor('#FF5500')
                    .setTitle(`🔍 SoundCloud Search Results: "${query}"`)
                    .setDescription(
                        results.map((song, i) => `**${i + 1}.** [${song.name}](${song.url}) — \`${song.formattedDuration}\``).join('\n')
                    )
                    .setFooter({ text: 'Select a track from the dropdown menu below within 30 seconds.' });

                const selectMenu = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('sc_search_select')
                        .setPlaceholder('🎧 Choose a SoundCloud track to play...')
                        .addOptions(
                            results.map((song, i) => ({
                                label: `${i + 1}. ${song.name.slice(0, 85)}`,
                                description: `Duration: ${song.formattedDuration} | Author: ${song.uploader?.name || 'SoundCloud'}`.slice(0, 95),
                                value: String(i)
                            }))
                        )
                );

                const searchReply = await message.reply({ embeds: [embed], components: [selectMenu] });

                const collector = searchReply.createMessageComponentCollector({
                    componentType: ComponentType.StringSelect,
                    filter: (i) => i.user.id === message.author.id,
                    time: 30000,
                    max: 1
                });

                collector.on('collect', async (i) => {
                    const chosenIndex = parseInt(i.values[0]);
                    const chosenTrack = results[chosenIndex];
                    await i.update({ content: `☁️ Loading **${chosenTrack.name}**...`, embeds: [], components: [] });
                    await distube.play(voiceChannel, chosenTrack, {
                        member: message.member,
                        textChannel: message.channel,
                        message
                    });
                });

                collector.on('end', (collected) => {
                    if (collected.size === 0) {
                        searchReply.edit({ components: [] }).catch(() => {});
                    }
                });
                break;
            }

            // --- PAUSE ---
            case 'pause': {
                if (!queue) return message.reply('❌ Nothing is playing right now.');
                if (queue.paused) return message.reply('⏸️ The track is already paused!');
                queue.pause();
                message.reply('⏸️ Paused the track.');
                break;
            }

            // --- RESUME ---
            case 'resume':
            case 'r':
            case 'unpause': {
                if (!queue) return message.reply('❌ Nothing is playing right now.');
                if (!queue.paused) return message.reply('▶️ The track is already playing!');
                queue.resume();
                message.reply('▶️ Resumed the track.');
                break;
            }

            // --- REPLAY / RESTART ---
            case 'replay':
            case 'restart': {
                if (!queue) return message.reply('❌ Nothing is playing right now.');
                queue.seek(0);
                message.reply('🔄 Restarted the current track from `0:00`!');
                break;
            }

            // --- SKIP ---
            case 'skip':
            case 's':
            case 'next': {
                if (!queue) return message.reply('❌ Nothing is playing right now.');
                if (queue.songs.length <= 1 && !queue.autoplay) {
                    await queue.stop();
                    return message.reply('⏭️ Skipped! No more songs left in the queue.');
                }
                await queue.skip();
                message.reply('⏭️ Skipped to the next track!');
                break;
            }

            // --- PREVIOUS ---
            case 'previous':
            case 'prev':
            case 'back': {
                if (!queue) return message.reply('❌ Nothing is playing right now.');
                if (queue.previousSongs.length === 0) return message.reply('❌ No previous track in history!');
                const prevSong = await queue.previous();
                message.reply(`⏮️ Playing previous track: **${prevSong.name}**`);
                break;
            }

            // --- SKIPTO / JUMP ---
            case 'skipto':
            case 'jump': {
                if (!queue) return message.reply('❌ Nothing is playing right now.');
                const pos = parseInt(args[0]);
                if (isNaN(pos) || pos < 1 || pos >= queue.songs.length) {
                    return message.reply(`❌ Provide a valid track number between \`1\` and \`${queue.songs.length - 1}\`.`);
                }
                await distube.jump(message.guildId, pos);
                message.reply(`⏭️ Jumped directly to track **#${pos}**: **${queue.songs[0].name}**!`);
                break;
            }

            // --- MOVE TRACK IN QUEUE (!move <from> <to>) ---
            case 'move':
            case 'mv': {
                if (!queue) return message.reply('❌ Nothing is playing right now.');
                const from = parseInt(args[0]);
                const to = parseInt(args[1]) || 1;

                if (isNaN(from) || from < 1 || from >= queue.songs.length || to < 1 || to >= queue.songs.length) {
                    return message.reply(`❌ Usage: \`${prefix}move <from_number> <to_number>\` (between \`1\` and \`${queue.songs.length - 1}\`).`);
                }

                const [movedSong] = queue.songs.splice(from, 1);
                queue.songs.splice(to, 0, movedSong);
                message.reply(`✅ Moved **${movedSong.name}** from position \`#${from}\` to \`#${to}\`!`);
                break;
            }

            // --- REMOVE TRACK FROM QUEUE (!remove <number>) ---
            case 'remove':
            case 'rm':
            case 'delete': {
                if (!queue) return message.reply('❌ Nothing is playing right now.');
                const index = parseInt(args[0]);
                if (isNaN(index) || index < 1 || index >= queue.songs.length) {
                    return message.reply(`❌ Specify a valid track number in the queue between \`1\` and \`${queue.songs.length - 1}\`.`);
                }
                const [removed] = queue.songs.splice(index, 1);
                message.reply(`🗑️ Removed **${removed.name}** from the queue.`);
                break;
            }

            // --- CLEAR UPCOMING QUEUE (!clear) ---
            case 'clear':
            case 'cl':
            case 'clearqueue': {
                if (!queue || queue.songs.length <= 1) {
                    return message.reply('❌ There are no upcoming songs in the queue to clear.');
                }
                const count = queue.songs.length - 1;
                queue.songs.splice(1);
                message.reply(`🧹 Cleared **${count}** upcoming track(s) from the queue!`);
                break;
            }

            // --- STOP ---
            case 'stop': {
                if (!queue) return message.reply('❌ Nothing is playing right now.');
                await queue.stop();
                if (stay247[message.guildId]?.enabled) {
                    message.reply('🛑 Stopped playback and cleared the queue (Staying in channel because **24/7 Mode** is ON).');
                } else {
                    distube.voices.get(message.guildId)?.leave();
                    message.reply('🛑 Stopped the music and left the voice channel.');
                }
                break;
            }

            // --- LEAVE / DISCONNECT ---
            case 'leave':
            case 'dc':
            case 'disconnect': {
                if (stay247[message.guildId]?.enabled) {
                    delete stay247[message.guildId];
                    save247();
                }
                if (queue) await queue.stop();
                distube.voices.get(message.guildId)?.leave();
                message.reply('👋 Disabled 24/7 mode and disconnected from the voice channel.');
                break;
            }

            // --- QUEUE WITH PAGINATION (!queue [page]) ---
            case 'queue':
            case 'q': {
                if (!queue) return message.reply('❌ The queue is currently empty.');
                const currentSong = queue.songs[0];
                const totalPages = Math.ceil((queue.songs.length - 1) / 10) || 1;
                let page = parseInt(args[0]) || 1;
                if (page < 1) page = 1;
                if (page > totalPages) page = totalPages;

                const start = (page - 1) * 10 + 1;
                const end = start + 10;
                const upcoming = queue.songs
                    .slice(start, end)
                    .map((song, idx) => `**${start + idx}.** [${song.name}](${song.url}) — \`${song.formattedDuration}\` (${song.user})`)
                    .join('\n');

                const is247 = stay247[message.guildId]?.enabled ? 'ON' : 'OFF';
                const embed = new EmbedBuilder()
                    .setColor('#FF5500')
                    .setTitle(`☁️ SoundCloud Queue (${queue.songs.length} Tracks)`)
                    .setThumbnail(currentSong.thumbnail || null)
                    .setDescription(
                        `**Now Playing:**\n🎧 [${currentSong.name}](${currentSong.url}) — \`${queue.formattedCurrentTime} / ${currentSong.formattedDuration}\`\n\n` +
                        `**Up Next (Page ${page}/${totalPages}):**\n${upcoming || '*No upcoming tracks in queue*'}`
                    )
                    .setFooter({
                        text: `Total Duration: ${queue.formattedDuration} | Vol: ${queue.volume}% | Loop: ${queue.repeatMode === 2 ? 'Queue' : queue.repeatMode === 1 ? 'Song' : 'Off'} | 24/7: ${is247}`
                    });

                message.reply({ embeds: [embed] });
                break;
            }

            // --- NOW PLAYING WITH PROGRESS BAR (!np) ---
            case 'nowplaying':
            case 'np': {
                if (!queue) return message.reply('❌ Nothing is playing right now.');
                const song = queue.songs[0];
                const bar = createProgressBar(queue.currentTime, song.duration, 15);
                const is247 = stay247[message.guildId]?.enabled ? '🟢 ON' : '🔴 OFF';

                const embed = new EmbedBuilder()
                    .setColor('#FF5500')
                    .setTitle('🎶 Now Playing on SoundCloud')
                    .setDescription(
                        `**[${song.name}](${song.url})**\n\n` +
                        `\`${queue.formattedCurrentTime}\` ${bar} \`${song.formattedDuration}\``
                    )
                    .setThumbnail(song.thumbnail || null)
                    .addFields(
                        { name: '👤 Requested By', value: `${song.user}`, inline: true },
                        { name: '🔊 Volume', value: `\`${queue.volume}%\``, inline: true },
                        { name: '♾️ 24/7 Mode', value: `\`${is247}\``, inline: true },
                        { name: '🔁 Loop Mode', value: `\`${queue.repeatMode === 2 ? 'Queue' : queue.repeatMode === 1 ? 'Song' : 'Off'}\``, inline: true },
                        { name: '📻 Autoplay', value: `\`${queue.autoplay ? 'On' : 'Off'}\``, inline: true },
                        { name: '🎛️ Active Filters', value: `\`${queue.filters.names.join(', ') || 'None'}\``, inline: true }
                    );

                message.reply({ embeds: [embed] });
                break;
            }

            // --- GRAB / SAVE TO DM (!grab / !save / !dm) ---
            case 'grab':
            case 'save':
            case 'dm': {
                if (!queue) return message.reply('❌ Nothing is playing right now.');
                const song = queue.songs[0];
                const embed = new EmbedBuilder()
                    .setColor('#FF5500')
                    .setTitle('📥 Saved SoundCloud Track')
                    .setThumbnail(song.thumbnail || null)
                    .setDescription(`**[${song.name}](${song.url})**`)
                    .addFields(
                        { name: '⏱️ Duration', value: `\`${song.formattedDuration}\``, inline: true },
                        { name: '🔗 Direct Link', value: `[Open on SoundCloud](${song.url})`, inline: true },
                        { name: '🏠 Saved From Server', value: `${message.guild.name}`, inline: false }
                    );

                try {
                    await message.author.send({ embeds: [embed] });
                    message.reply('📬 Sent the current track details to your **Direct Messages**!');
                } catch {
                    message.reply('❌ I could not DM you! Please make sure your Direct Messages are open.');
                }
                break;
            }

            // --- VOLUME ---
            case 'volume':
            case 'vol':
            case 'v': {
                if (!queue) return message.reply('❌ Nothing is playing right now.');
                const vol = parseInt(args[0]);
                if (isNaN(vol) || vol < 1 || vol > 150) {
                    return message.reply(`🔊 Current volume is **${queue.volume}%**. Specify a number between \`1\` and \`150\`.`);
                }
                queue.setVolume(vol);
                message.reply(`🔊 Volume set to **${vol}%**.`);
                break;
            }

            // --- LOOP / REPEAT ---
            case 'loop':
            case 'repeat': {
                if (!queue) return message.reply('❌ Nothing is playing right now.');
                let mode = args[0]?.toLowerCase();
                let modeNum = 0;

                if (mode === 'off' || mode === '0') modeNum = 0;
                else if (mode === 'song' || mode === 'track' || mode === '1') modeNum = 1;
                else if (mode === 'queue' || mode === 'all' || mode === '2') modeNum = 2;
                else modeNum = (queue.repeatMode + 1) % 3;

                queue.setRepeatMode(modeNum);
                const modeText = modeNum === 2 ? '🔁 Loop Queue' : modeNum === 1 ? '🔂 Loop Current Song' : '➡️ Loop Off';
                message.reply(`Loop mode set to: **${modeText}**`);
                break;
            }

            // --- SHUFFLE ---
            case 'shuffle':
            case 'mix': {
                if (!queue) return message.reply('❌ Nothing is playing right now.');
                if (queue.songs.length < 3) return message.reply('❌ Need at least 3 songs in the queue to shuffle!');
                await queue.shuffle();
                message.reply('🔀 Shuffled the queue!');
                break;
            }

            // --- SEEK ---
            case 'seek': {
                if (!queue) return message.reply('❌ Nothing is playing right now.');
                const time = parseInt(args[0]);
                if (isNaN(time) || time < 0 || time > queue.songs[0].duration) {
                    return message.reply(`❌ Provide a timestamp in seconds between \`0\` and \`${queue.songs[0].duration}\`.`);
                }
                queue.seek(time);
                message.reply(`⏩ Seeked to \`${time}s\`.`);
                break;
            }

            // --- FORWARD (!forward / !ff) ---
            case 'forward':
            case 'ff': {
                if (!queue) return message.reply('❌ Nothing is playing right now.');
                const sec = parseInt(args[0]) || 10;
                const target = Math.min(queue.currentTime + sec, queue.songs[0].duration - 1);
                queue.seek(target);
                message.reply(`⏩ Fast-forwarded \`${sec}s\` (Now at \`${queue.formattedCurrentTime}\`).`);
                break;
            }

            // --- REWIND (!rewind / !rw) ---
            case 'rewind':
            case 'rw': {
                if (!queue) return message.reply('❌ Nothing is playing right now.');
                const sec = parseInt(args[0]) || 10;
                const target = Math.max(queue.currentTime - sec, 0);
                queue.seek(target);
                message.reply(`⏪ Rewound \`${sec}s\` (Now at \`${queue.formattedCurrentTime}\`).`);
                break;
            }

            // --- AUTOPLAY ---
            case 'autoplay':
            case 'ap': {
                if (!queue) return message.reply('❌ Nothing is playing right now.');
                const autoplay = queue.toggleAutoplay();
                message.reply(`📻 SoundCloud Autoplay is now: **${autoplay ? 'ON' : 'OFF'}**`);
                break;
            }

            // --- FILTERS ---
            case 'filter':
            case 'filters':
            case 'fx': {
                if (!queue) return message.reply('❌ Nothing is playing right now.');
                const filterName = args[0]?.toLowerCase();

                if (!filterName) {
                    return message.reply(
                        `🎛️ **Active Filters:** \`${queue.filters.names.join(', ') || 'None'}\`\n` +
                        `**Available Filters:** \`${allFilterNames.join('`, `')}\`\n` +
                        `Use \`${prefix}filter <name>\` or \`${prefix}filter off\` to clear.`
                    );
                }

                if (filterName === 'off' || filterName === 'clear' || filterName === 'reset') {
                    queue.filters.clear();
                    return message.reply('🎛️ Cleared all audio filters.');
                }

                if (!allFilterNames.includes(filterName)) {
                    return message.reply(`❌ Invalid filter! Choose from:\n\`${allFilterNames.join('`, `')}\``);
                }

                if (queue.filters.has(filterName)) {
                    queue.filters.remove(filterName);
                    message.reply(`🎛️ Removed **${filterName}** filter.`);
                } else {
                    queue.filters.add(filterName);
                    message.reply(`🎛️ Applied **${filterName}** filter!`);
                }
                break;
            }

            // --- PING ---
            case 'ping':
            case 'latency': {
                message.reply(`🏓 **Pong!** WebSocket Ping: \`${client.ws.ping}ms\``);
                break;
            }

            // --- STATS / BOTINFO / UPTIME ---
            case 'stats':
            case 'botinfo':
            case 'uptime': {
                const totalSeconds = Math.floor(process.uptime());
                const days = Math.floor(totalSeconds / 86400);
                const hours = Math.floor((totalSeconds % 86400) / 3600);
                const minutes = Math.floor((totalSeconds % 3600) / 60);
                const seconds = totalSeconds % 60;
                const uptimeStr = `${days}d ${hours}h ${minutes}m ${seconds}s`;
                const memUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);

                const embed = new EmbedBuilder()
                    .setColor('#FF5500')
                    .setTitle('📊 SoundCloud Music Bot — System Statistics')
                    .addFields(
                        { name: '⏱️ Uptime', value: `\`${uptimeStr}\``, inline: true },
                        { name: '🏓 Ping', value: `\`${client.ws.ping}ms\``, inline: true },
                        { name: '🧠 RAM Usage', value: `\`${memUsage} MB\``, inline: true },
                        { name: '🌐 Servers', value: `\`${client.guilds.cache.size}\``, inline: true },
                        { name: '🎧 Active Players', value: `\`${distube.queues.collection.size}\``, inline: true },
                        { name: '⚙️ Platform', value: `\`Node ${process.version} (${os.platform()})\``, inline: true }
                    );
                message.reply({ embeds: [embed] });
                break;
            }
        }
    } catch (err) {
        console.error('Command Error:', err);
        message.reply(`❌ Error: \`${err.message || 'Something went wrong!'}\``);
    }
});

// ==========================================
// 10. DISTUBE MUSIC EVENTS & CONTROLLER BUTTONS
// ==========================================
distube
    .on('playSong', (queue, song) => {
        const is247 = stay247[queue.id]?.enabled ? '♾️ 24/7 Mode Active' : 'Standard Mode';
        const embed = new EmbedBuilder()
            .setColor('#FF5500')
            .setTitle('☁️ Now Playing from SoundCloud')
            .setDescription(`**[${song.name}](${song.url})**`)
            .setThumbnail(song.thumbnail || null)
            .addFields(
                { name: '⏱️ Duration', value: `\`${song.formattedDuration}\``, inline: true },
                { name: '👤 Requested By', value: `${song.user}`, inline: true },
                { name: '🔊 Volume', value: `\`${queue.volume}%\``, inline: true }
            )
            .setFooter({ text: `${is247} • Queue: ${queue.songs.length} song(s)` });

        const controlRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('np_pause_resume').setEmoji('⏯️').setLabel('Pause/Resume').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('np_skip').setEmoji('⏭️').setLabel('Skip').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('np_stop').setEmoji('🛑').setLabel('Stop').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('np_loop').setEmoji('🔁').setLabel('Loop').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('np_shuffle').setEmoji('🔀').setLabel('Shuffle').setStyle(ButtonStyle.Secondary)
        );

        queue.textChannel?.send({ embeds: [embed], components: [controlRow] });
    })
    .on('addSong', (queue, song) => {
        const embed = new EmbedBuilder()
            .setColor('#FFA500')
            .setDescription(`✅ Added **[${song.name}](${song.url})** (\`${song.formattedDuration}\`) to the queue • Requested by ${song.user}`);
        queue.textChannel?.send({ embeds: [embed] });
    })
    .on('addList', (queue, playlist) => {
        const embed = new EmbedBuilder()
            .setColor('#FFA500')
            .setDescription(`✅ Added SoundCloud Playlist **[${playlist.name}](${playlist.url})** (\`${playlist.songs.length} tracks\`) to the queue!`);
        queue.textChannel?.send({ embeds: [embed] });
    })
    .on('finish', (queue) => {
        if (stay247[queue.id]?.enabled) {
            queue.textChannel?.send('♾️ Queue finished! Staying in the voice channel because **24/7 Mode** is enabled.');
        } else {
            queue.textChannel?.send('✅ Queue finished! Leaving the voice channel...');
            distube.voices.get(queue.id)?.leave();
        }
    })
    .on('error', (error, queue) => {
        console.error('DisTube Error:', error);
        queue?.textChannel?.send(`❌ Playback Error: \`${error.message.slice(0, 1900)}\``);
    });

client.login(process.env.TOKEN);
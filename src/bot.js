const { Client, Collection, WebhookClient } = require('discord.js');
const { readdirSync, writeFileSync, readFileSync, mkdirSync, writeFile } = require('node:fs');
const { default: axios } = require('axios');
const logger = require('./modules/logger');
const { localize } = require('./modules/localization');
const { ownerId, developerIds, roleIds, colors } = require('../config');
const { diffLines } = require('diff');
const EmbedMaker = require('./modules/embed');
const { execSync } = require('node:child_process');

const client = new Client({
    intents: [
        'Guilds'
    ]
});
const webhooks = {
    extraStuff: new WebhookClient({
        url: process.env.EXTRA_STUFF_WEBHOOK
    }),
    otherChanges: new WebhookClient({
        url: process.env.OTHER_CHANGES_WEBHOOK
    })
};

client.commands = new Collection();

const commandFiles = readdirSync('src/commands').filter(file => file.endsWith('.js'));

if (commandFiles.length > 0) logger('info', 'COMMAND', 'Found', commandFiles.length.toString(), 'commands');
else logger('warning', 'COMMAND', 'No commands found');

for (const file of commandFiles) {
    const command = require(`./commands/${file}`);

    client.commands.set(command.data.name, command);

    logger('success', 'COMMAND', 'Loaded command', command.data.name);
};

async function checkScript(script, i, webhook, pings) {
    logger('info', 'SCRIPT', 'Checking script', script);

    let oldScript = '';

    try {
        oldScript = readFileSync(`scripts/current${i}.js`, 'utf-8').toString();
    } catch (error) {
        try {
            writeFileSync(`scripts/current${i}.js`, '', 'utf-8');

            oldScript = readFileSync(`scripts/current${i}.js`, 'utf-8').toString();
        } catch (error) {
            try {
                mkdirSync('scripts');
                writeFileSync(`scripts/current${i}.js`, '', 'utf-8');

                oldScript = readFileSync(`scripts/current${i}.js`, 'utf-8').toString();
            } catch (error) {
                return logger('error', 'SCRIPT', 'Error while reading script', 'current.js', `\n${error}`);
            };
        };
    };

    let newScript = (await axios.get(`https://canary.discord.com/assets/${script}`)).data;

    writeFileSync(`scripts/current${i}.js`, newScript, 'utf-8');

    newScript = execSync(`beautifier ./scripts/current${i}.js`, {
        maxBuffer: Infinity
    }).toString();

    writeFileSync(`scripts/current${i}.js`, newScript, 'utf-8');

    if (oldScript === '') return logger('warning', 'SCRIPT', 'Old script empty, skipping', script);
    if (oldScript === newScript) return logger('warning', 'SCRIPT', 'Scripts are the same, skipping', script);

    logger('success', 'SCRIPT', 'Script fetched', script);

    let diff = diffLines(oldScript, newScript);
    let diffText = '';
    let writing = false;

    for (let line of diff) {
        if (line.added) {
            diffText += `${!writing ? '\n...\n' : '\n'}+ ${line.value.split('\n').filter(l => l !== '').join('\n+ ')}`;
            writing = true;
        } else if (line.removed) {
            diffText += `${!writing ? '\n...\n' : '\n'}- ${line.value.split('\n').filter(l => l !== '').join('\n- ')}`;
            writing = true;
        } else writing = false;
    };

    logger('success', 'SCRIPT', 'Generated diff for script', script);

    const embed = new EmbedMaker(client)
        .setTitle('Code Changes')
        .setDescription(`\`\`\`diff\n${diffText.length > 4000 ? diffText.slice(0, 4000) + '...' : diffText}\`\`\``)
        .setFields(
            {
                name: 'Script',
                value: script,
                inline: true
            },
            {
                name: 'Updated At',
                value: `<t:${Math.floor(Date.now() / 1000)}:R>`,
                inline: true
            }
        );

    embed.data.footer.text = 'Powered by Discord-Datamining/Discord-Datamining';

    webhooks[webhook].send({
        content: pings.map(id => `<@&${id}>`).join(' '),
        embeds: [embed]
    });

    logger('success', 'SCRIPT', 'Sent diff for script', script);
};

async function checkScripts() {
    let branch = (await axios.get('https://api.github.com/repos/Discord-Datamining/Discord-Datamining/commits/master')).data;
    let scripts = branch.commit.message.match(/[a-f0-9]*\.js/gm);

    if (scripts.length === 0) return logger('warning', 'SCRIPT', 'No scripts found');

    logger('info', 'SCRIPT', 'Found', scripts.length.toString(), 'scripts');

    for (let i = 0; i < scripts.length; i++) {
        await checkScript(scripts[i], i, 'otherChanges', [roleIds.extraStuff, roleIds.codeChanges]);
    };
};

async function checkArticles() {
    try {
        let oldSupportSections = '';

        try {
            oldSupportSections = readFileSync('articles/supportSections.json', 'utf-8');
        } catch (error) {
            try {
                writeFileSync('articles/supportSections.json', '', 'utf-8');

                oldSupportSections = readFileSync('articles/supportSections.json', 'utf-8');
            } catch (error) {
                mkdirSync('articles');
                writeFileSync('articles/supportSections.json', '', 'utf-8');

                oldSupportSections = readFileSync('articles/supportSections.json', 'utf-8');
            };
        };

        let supportSections = (await axios.get('https://hammerandchisel.zendesk.com/api/v2/help_center/en-us/sections')).data?.sections;

        writeFileSync('articles/supportSections.json', JSON.stringify(supportSections, null, 4), 'utf-8');
        logger('success', 'ARTICLE', 'Fetched support sections');

        let oldSupportArticles = '';

        try {
            oldSupportArticles = readFileSync('articles/supportArticles.json', 'utf-8');
        } catch (error) {
            logger('error', 'ARTICLE', 'Error while reading', 'articles/supportArticles.json', error);
        };

        let supportArticles = (await axios.get('https://hammerandchisel.zendesk.com/api/v2/help_center/en-us/articles')).data?.articles;

        writeFileSync('articles/supportArticles.json', JSON.stringify(supportArticles, null, 4), 'utf-8');
        logger('success', 'ARTICLE', 'Fetched support articles');

        if (oldSupportSections !== '') {
            oldSupportSections = JSON.parse(oldSupportSections);

            let removed = [];
            let added = [];
            let changed = [];

            for (let data of supportSections) {
                if (!oldSupportSections.filter(s => s.id === data.id)[0]) added.push(data);
            };

            for (let data of oldSupportSections) {
                if (!supportSections.filter(s => s.id === data.id)[0]) removed.push(data);
            };

            for (let data of supportSections) {
                if (oldSupportSections.filter(s => s.id === data.id)[0] && oldSupportSections.filter(s => s.id === data.id)[0].name !== data.name) changed.push(data);
            };

            logger('success', 'ARTICLE', 'Generated diff for', 'supportSections.js');

            if (added.length > 0 || removed.length > 0 || changed.length > 0) {
                for (let data of added) {
                    const embed = new EmbedMaker(client)
                        .setColor(colors.green)
                        .setTitle('Added Support Section')
                        .setFields(
                            {
                                name: 'Link',
                                value: data.html_url,
                                inline: false
                            },
                            {
                                name: 'Id',
                                value: data.id.toString(),
                                inline: true
                            },
                            {
                                name: 'Category Id',
                                value: data.category_id.toString(),
                                inline: true
                            },
                            {
                                name: 'Created At',
                                value: `<t:${Math.floor(new Date(data.created_at).getTime() / 1000)}:R>`,
                                inline: true
                            },
                            {
                                name: 'Name',
                                value: data.name,
                                inline: true
                            },
                            {
                                name: 'Description',
                                value: data.description === '' ? 'None' : data.description,
                                inline: true
                            },
                            {
                                name: 'Outdated',
                                value: data.outdated ? '✅' : '❌',
                                inline: true
                            },
                            {
                                name: 'Parent Section Id',
                                value: data.parent_section_id ?? 'None',
                                inline: true
                            },
                            {
                                name: 'Theme Template',
                                value: data.theme_template,
                                inline: true
                            }
                        )

                    otherChangesWebhook.send({
                        content: `<@&${roleIds.otherChanges}> <@&${roleIds.urlStuff}>`,
                        embeds: [embed]
                    });

                    // Wait 3 seconds to prevent ratelimit
                    await new Promise(resolve => setTimeout(resolve, 3000));
                };

                for (let data of changed) {
                    const embed = new EmbedMaker(client)
                        .setColor(colors.yellow)
                        .setTitle('Updated Support Section')
                        .setFields(
                            {
                                name: 'Link',
                                value: data.html_url,
                                inline: false
                            },
                            {
                                name: 'Id',
                                value: data.id.toString(),
                                inline: true
                            },
                            {
                                name: 'Category Id',
                                value: data.category_id.toString(),
                                inline: true
                            },
                            {
                                name: 'Created At',
                                value: `<t:${Math.floor(new Date(data.created_at).getTime() / 1000)}:R>`,
                                inline: true
                            },
                            {
                                name: 'Updated At',
                                value: `<t:${Math.floor(new Date(data.updated_at).getTime() / 1000)}:R>`,
                                inline: true
                            },
                            {
                                name: 'Name',
                                value: data.name,
                                inline: true
                            },
                            {
                                name: 'Description',
                                value: data.description === '' ? 'None' : data.description,
                                inline: true
                            },
                            {
                                name: 'Outdated',
                                value: data.outdated ? '✅' : '❌',
                                inline: true
                            },
                            {
                                name: 'Parent Section Id',
                                value: data.parent_section_id ?? 'None',
                                inline: true
                            },
                            {
                                name: 'Theme Template',
                                value: data.theme_template,
                                inline: true
                            }
                        )

                    otherChangesWebhook.send({
                        content: `<@&${roleIds.otherChanges}> <@&${roleIds.urlStuff}>`,
                        embeds: [embed]
                    });

                    // Wait 3 seconds to prevent ratelimit
                    await new Promise(resolve => setTimeout(resolve, 3000));
                };

                for (let data of removed) {
                    const embed = new EmbedMaker(client)
                        .setColor(colors.red)
                        .setTitle('Removed Support Section')
                        .setFields(
                            {
                                name: 'Link',
                                value: data.html_url,
                                inline: false
                            },
                            {
                                name: 'Id',
                                value: data.id.toString(),
                                inline: true
                            },
                            {
                                name: 'Category Id',
                                value: data.category_id.toString(),
                                inline: true
                            },
                            {
                                name: 'Created At',
                                value: `<t:${Math.floor(new Date(data.created_at).getTime() / 1000)}:R>`,
                                inline: true
                            },
                            {
                                name: 'Updated At',
                                value: `<t:${Math.floor(new Date(data.updated_at).getTime() / 1000)}:R>`,
                                inline: true
                            },
                            {
                                name: 'Name',
                                value: data.name,
                                inline: true
                            },
                            {
                                name: 'Description',
                                value: data.description === '' ? 'None' : data.description,
                                inline: true
                            },
                            {
                                name: 'Outdated',
                                value: data.outdated ? '✅' : '❌',
                                inline: true
                            },
                            {
                                name: 'Parent Section Id',
                                value: data.parent_section_id ?? 'None',
                                inline: true
                            },
                            {
                                name: 'Theme Template',
                                value: data.theme_template,
                                inline: true
                            }
                        )

                    otherChangesWebhook.send({
                        content: `<@&${roleIds.otherChanges}> <@&${roleIds.urlStuff}>`,
                        embeds: [embed]
                    });

                    // Wait 3 seconds to prevent ratelimit
                    await new Promise(resolve => setTimeout(resolve, 3000));
                };

                logger('success', 'ARTICLE', 'Generated response for', 'supportSections.js');
            };
        };
        if (oldSupportArticles !== '') {
            oldSupportArticles = JSON.parse(oldSupportArticles);

            let removed = [];
            let added = [];
            let changed = [];

            for (let data of supportArticles) {
                if (!oldSupportArticles.filter(s => s.id === data.id)[0]) added.push(data);
            };

            for (let data of oldSupportArticles) {
                if (!supportArticles.filter(s => s.id === data.id)[0]) removed.push(data);
            };

            for (let data of supportArticles) {
                if (oldSupportArticles.filter(s => s.id === data.id)[0] && (oldSupportArticles.filter(s => s.id === data.id)[0].name !== data.name || oldSupportArticles.filter(s => s.id === data.id)[0].body !== data.body || oldSupportArticles.filter(s => s.id === data.id)[0].title !== data.title)) changed.push(data);
            };

            logger('success', 'ARTICLE', 'Generated diff for', 'supportSections.js');

            if (added.length > 0 || removed.length > 0 || changed.length > 0) {
                for (let data of added) {
                    const embed = new EmbedMaker(client)
                        .setColor(colors.green)
                        .setTitle('Added Support Article')
                        .setFields(
                            {
                                name: 'Link',
                                value: data.html_url,
                                inline: false
                            },
                            {
                                name: 'Id',
                                value: data.id.toString(),
                                inline: true
                            },
                            {
                                name: 'Author Id',
                                value: data.author_id.toString(),
                                inline: true
                            },
                            {
                                name: 'Comments Enabled',
                                value: data.comments_disabled ? '❌' : '✅',
                                inline: true
                            },
                            {
                                name: 'Draft',
                                value: data.draft ? '✅' : '❌',
                                inline: true
                            },
                            {
                                name: 'Section Id',
                                value: data.section_id.toString(),
                                inline: true
                            },
                            {
                                name: 'Created At',
                                value: `<t:${Math.floor(new Date(data.created_at).getTime() / 1000)}:R>`,
                                inline: true
                            },
                            {
                                name: 'Name',
                                value: data.name,
                                inline: true
                            },
                            {
                                name: 'Title',
                                value: data.title,
                                inline: true
                            },
                            {
                                name: 'Outdated',
                                value: data.outdated ? '✅' : '❌',
                                inline: true
                            },
                            {
                                name: 'Outdated Locales',
                                value: data.outdated_locales.length > 0 ? data.outdated_locales.join(', ') : 'None',
                                inline: true
                            },
                            {
                                name: 'Tags',
                                value: data.label_names.length > 0 ? data.label_names.join(', ') : 'None',
                                inline: true
                            }
                        );

                    otherChangesWebhook.send({
                        content: `<@&${roleIds.otherChanges}> <@&${roleIds.urlStuff}>`,
                        embeds: [embed]
                    });

                    // Wait 3 seconds to prevent ratelimit
                    await new Promise(resolve => setTimeout(resolve, 3000));
                };

                for (let data of changed) {
                    let diffSupportArticleText = '';
                    let diffSupportArticle = diffLines(oldSupportArticles.filter(s => s.id === data.id)[0].body, data.body).filter(l => l.added || l.removed);

                    diffSupportArticleText = diffSupportArticle.map(article => `${article.added ? '+' : '-'} ${article.value}`).join('\n');

                    const embed = new EmbedMaker(client)
                        .setColor(colors.yellow)
                        .setTitle('Updated Support Article')
                        .setFields(
                            {
                                name: 'Link',
                                value: data.html_url,
                                inline: false
                            },
                            {
                                name: 'Id',
                                value: data.id.toString(),
                                inline: true
                            },
                            {
                                name: 'Author Id',
                                value: data.author_id.toString(),
                                inline: true
                            },
                            {
                                name: 'Comments Enabled',
                                value: data.comments_disabled ? '❌' : '✅',
                                inline: true
                            },
                            {
                                name: 'Draft',
                                value: data.draft ? '✅' : '❌',
                                inline: true
                            },
                            {
                                name: 'Section Id',
                                value: data.section_id.toString(),
                                inline: true
                            },
                            {
                                name: 'Created At',
                                value: `<t:${Math.floor(new Date(data.created_at).getTime() / 1000)}:R>`,
                                inline: true
                            },
                            {
                                name: 'Updated At',
                                value: `<t:${Math.floor(new Date(data.updated_at).getTime() / 1000)}:R>`,
                                inline: true
                            },
                            {
                                name: 'Name',
                                value: data.name,
                                inline: true
                            },
                            {
                                name: 'Title',
                                value: data.title,
                                inline: true
                            },
                            {
                                name: 'Outdated',
                                value: data.outdated ? '✅' : '❌',
                                inline: true
                            },
                            {
                                name: 'Outdated Locales',
                                value: data.outdated_locales.length > 0 ? data.outdated_locales.join(', ') : 'None',
                                inline: true
                            },
                            {
                                name: 'Tags',
                                value: data.label_names.length > 0 ? data.label_names.join(', ') : 'None',
                                inline: true
                            }
                        );

                    if (diffSupportArticleText !== '') embed.setDescription(`\`\`\`diff\n${diffSupportArticleText.length > 3500 ? `${diffSupportArticleText.slice(0, 3500)}...` : diffSupportArticleText}\`\`\``);

                    otherChangesWebhook.send({
                        content: `<@&${roleIds.otherChanges}> <@&${roleIds.urlStuff}>`,
                        embeds: [embed]
                    });

                    // Wait 3 seconds to prevent ratelimit
                    await new Promise(resolve => setTimeout(resolve, 3000));
                };

                for (let data of removed) {
                    const embed = new EmbedMaker(client)
                        .setColor(colors.red)
                        .setTitle('Removed Support Article')
                        .setFields(
                            {
                                name: 'Link',
                                value: data.html_url,
                                inline: false
                            },
                            {
                                name: 'Id',
                                value: data.id.toString(),
                                inline: true
                            },
                            {
                                name: 'Author Id',
                                value: data.author_id.toString(),
                                inline: true
                            },
                            {
                                name: 'Comments Enabled',
                                value: data.comments_disabled ? '❌' : '✅',
                                inline: true
                            },
                            {
                                name: 'Draft',
                                value: data.draft ? '✅' : '❌',
                                inline: true
                            },
                            {
                                name: 'Section Id',
                                value: data.section_id.toString(),
                                inline: true
                            },
                            {
                                name: 'Created At',
                                value: `<t:${Math.floor(new Date(data.created_at).getTime() / 1000)}:R>`,
                                inline: true
                            },
                            {
                                name: 'Updated At',
                                value: `<t:${Math.floor(new Date(data.updated_at).getTime() / 1000)}:R>`,
                                inline: true
                            },
                            {
                                name: 'Name',
                                value: data.name,
                                inline: true
                            },
                            {
                                name: 'Title',
                                value: data.title,
                                inline: true
                            },
                            {
                                name: 'Outdated',
                                value: data.outdated ? '✅' : '❌',
                                inline: true
                            },
                            {
                                name: 'Outdated Locales',
                                value: data.outdated_locales.length > 0 ? data.outdated_locales.join(', ') : 'None',
                                inline: true
                            },
                            {
                                name: 'Tags',
                                value: data.label_names.length > 0 ? data.label_names.join(', ') : 'None',
                                inline: true
                            }
                        )

                    otherChangesWebhook.send({
                        content: `<@&${roleIds.otherChanges}> <@&${roleIds.urlStuff}>`,
                        embeds: [embed]
                    });

                    // Wait 3 seconds to prevent ratelimit
                    await new Promise(resolve => setTimeout(resolve, 3000));
                };

                logger('success', 'ARTICLE', 'Generated response for', 'supportSections.js');
            };
        };
    } catch (error) {
        return logger('error', 'ARTICLE', 'Error checking articles', `${error?.response?.status} ${error?.response?.statusText}\n`, JSON.stringify(error?.response?.data ?? error, null, 4));
    };
};

client.on('ready', async () => {
    logger('info', 'BOT', 'Logged in as', client.user.tag);
    logger('info', 'COMMAND', 'Registering commands');

    axios.put(`https://discord.com/api/v10/applications/${client.user.id}/commands`, client.commands.map(command => command.data.toJSON()), {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bot ${process.env.DISCORD_TOKEN}`
        }
    }).then(() => logger('success', 'COMMAND', 'Registered commands')).catch(error => logger('error', 'COMMAND', 'Error while registering commands', `${error?.response?.status} ${error?.response?.statusText}\n`, JSON.stringify(error?.response?.data ?? error, null, 4)));

    await checkScripts();
    await checkArticles();

    setInterval(async () => {
        await checkScripts();
        await checkArticles();
    }, 1000 * 60 * 3);
});

client.on('interactionCreate', async interaction => {
    if (interaction.isCommand() || interaction.isContextMenuCommand()) {
        logger('debug', 'COMMAND', 'Received command', `${interaction.commandName} (${interaction.commandId})`, 'from', interaction.guild ? `${interaction.guild.name} (${interaction.guild.id})` : 'DMs', 'by', `${interaction.user.tag} (${interaction.user.id})`);

        const command = client.commands.get(interaction.commandName);

        if (!command) {
            logger('warning', 'COMMAND', 'Command ', interaction.commandName, 'not found');

            return interaction.reply({
                content: localize(interaction.locale, 'NOT_FOUND', 'Command'),
                ephemeral: true
            });
        };
        if (command.category === 'Owner' && interaction.user.id !== ownerId) {
            logger('debug', 'COMMAND', 'Command', interaction.commandName, 'blocked for', interaction.user.tag, 'because it is owner only');

            return interaction.reply({
                content: localize(interaction.locale, 'OWNER_ONLY'),
                ephemeral: true
            });
        };
        if (command.category === 'Developer' && !developerIds.includes(interaction.user.id) && interaction.user.id !== ownerId) {
            logger('debug', 'COMMAND', 'Command', interaction.commandName, 'blocked for', interaction.user.tag, 'because it is developer only');

            return interaction.reply({
                content: localize(interaction.locale, 'DEVELOPER_ONLY'),
                ephemeral: true
            });
        };

        try {
            await command.execute(interaction);
        } catch (error) {
            logger('error', 'COMMAND', 'Error while executing command:', `${error.message}\n`, error.stack);

            return interaction.reply({
                content: localize(interaction.locale, 'COMMAND_ERROR', 'command', error.message),
                ephemeral: true
            }).catch(() => interaction.editReply({
                content: localize(interaction.locale, 'COMMAND_ERROR', 'command', error.message)
            }));
        };
    } else if (interaction.isMessageComponent()) {
        logger('debug', 'COMMAND', 'Received message component', `${interaction.customId} (${interaction.componentType})`, 'from', interaction.guild ? `${interaction.guild.name} (${interaction.guild.id})` : 'DMs', 'by', `${interaction.user.tag} (${interaction.user.id})`);

        try {
            switch (interaction.customId) {
                default: {
                    logger('warning', 'COMMAND', 'Message component', interaction.customId, 'not found');
                }
            };
        } catch (error) {
            logger('error', 'COMMAND', 'Error while executing message component:', `${error.message}\n`, error.stack);

            return interaction.reply({
                content: localize(interaction.locale, 'COMMAND_ERROR', 'message component', error.message),
                ephemeral: true
            }).catch(() => interaction.editReply({
                content: localize(interaction.locale, 'COMMAND_ERROR', 'message component', error.message)
            }));
        }
    } else if (interaction.isModalSubmit()) {
        logger('debug', 'COMMAND', 'Received modal submit', interaction.customId, 'from', interaction.guild ? `${interaction.guild.name} (${interaction.guild.id})` : 'DMs', 'by', `${interaction.user.tag} (${interaction.user.id})`);

        try {
            switch (interaction.customId) {
                default: {
                    logger('warning', 'COMMAND', 'Modal', interaction.customId, 'not found');

                    return interaction.reply({
                        content: localize(interaction.locale, 'NOT_FOUND', 'Modal'),
                        ephemeral: true
                    });
                }
            };
        } catch (error) {
            logger('error', 'COMMAND', 'Error while executing modal:', `${error.message}\n`, error.stack);

            return interaction.reply({
                content: localize(interaction.locale, 'COMMAND_ERROR', 'modal', error.message),
                ephemeral: true
            }).catch(() => interaction.editReply({
                content: localize(interaction.locale, 'COMMAND_ERROR', 'modal', error.message)
            }));
        };
    };
});

client.login(process.env.DISCORD_TOKEN);
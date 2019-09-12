#!/usr/bin/env node
/* eslint-disable no-console */
/* eslint-disable camelcase */ // github API convention
/* eslint-env node */
const exitWithError = err => {
		console.error('Error', err.stack);
		if (err.data) {
			console.error(err.data);
		}
		process.exit(1);
	},
	{ GITHUB_SHA, GITHUB_EVENT_PATH, GITHUB_TOKEN, GITHUB_WORKSPACE } = process.env;

if (GITHUB_TOKEN == null) {
	exitWithError(new Error('Missing Github token'));
}

if (GITHUB_EVENT_PATH == null) {
	exitWithError(new Error('Can not find GITHUB_EVENT_PATH - is this run in Github Actions?'));
}

const https = require('https'),
	request = (url, options) =>
		new Promise((resolve, reject) => {
			const req = https
				.request(url, options, res => {
					let data = '';
					res.on('data', chunk => {
						data += chunk;
					});
					res.on('end', () => {
						if (res.statusCode >= 400) {
							const err = new Error(`Received status code ${ res.statusCode }`);
							err.response = res;
							err.data = data;
							reject(err);
						} else {
							resolve({
								res,
								data: JSON.parse(data)
							});
						}
					});
				})
				.on('error', reject);
			if (options.body) {
				req.end(JSON.stringify(options.body));
			} else {
				req.end();
			}
		}),
	event = require(GITHUB_EVENT_PATH),
	{
		repository: {
			name: repo,
			owner: {
				login: owner
			}
		}
	} = event,
	checkName = 'ESLint check';

let checkSha = GITHUB_SHA;

if (event.pull_request) {
	checkSha = event.pull_request.head.sha;
}

const headers = {
		'Content-Type': 'application/json',
		Accept: 'application/vnd.github.antiope-preview+json',
		Authorization: `Bearer ${ GITHUB_TOKEN }`,
		'User-Agent': 'eslint-action'
	},
	createCheck = async () => {
		const { data } = await request(`https://api.github.com/repos/${ owner }/${ repo }/check-runs`, {
			method: 'POST',
			headers,
			body: {
				name: checkName,
				head_sha: checkSha,
				status: 'in_progress',
				started_at: (new Date()).toISOString()
			}
		});
		return data.id;
	},
	eslint = () => {
		const eslint = require('eslint'),
			cli = new eslint.CLIEngine(),
			report = cli.executeOnFiles(['.']),
			// fixableErrorCount, fixableWarningCount are available too
			levels = ['notice', 'warning', 'failure'];

		const annotations = report.results.reduce((annoList, result) => {
			const path = result.filePath.substring(GITHUB_WORKSPACE.length + 1);
			return annoList.concat(result.messages.map(m => {
				const singleLine = m.line === m.endLine;
				return {
					path,
					start_column: singleLine && m.column,
					end_column: singleLine && m.endColumn,
					start_line: m.line,
					end_line: m.endLine,
					annotation_level: levels[m.severity],
					// title: `${ path }#L${ m.line }`,
					// raw_details: 'Nothing much',
					message: `${ m.ruleId }: ${ m.message }`
				};
			}));
		}, []);

		const { errorCount, warningCount } = report;

		return {
			conclusion: errorCount > 0 ? 'failure' : 'success',
			output: {
				title: checkName,
				summary: `${ errorCount } error(s), ${ warningCount } warning(s) found`,
				text: 'A little bit of text',
				annotations
			}
		};
	},
	updateCheck = async (id, conclusion, output) =>
		await request(`https://api.github.com/repos/${ owner }/${ repo }/check-runs/${ id }`, {
			method: 'PATCH',
			headers,
			body: {
				name: checkName,
				head_sha: checkSha,
				status: 'completed',
				completed_at: (new Date()).toISOString(),
				conclusion,
				output
			}
		}),
	run = async () => {
		const id = await createCheck();
		try {
			const { conclusion, output } = eslint();
			console.log(conclusion, output);
			await updateCheck(id, conclusion, output);
		} catch (err) {
			await updateCheck(id, 'failure');
			exitWithError(err);
		}
	};

run().catch(exitWithError);

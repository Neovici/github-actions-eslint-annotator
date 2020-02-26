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
	{
		GITHUB_SHA, GITHUB_EVENT_PATH, GITHUB_TOKEN, GITHUB_WORKSPACE
	} = process.env;

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
	getChangedFiles = async targetBranch => {
		const util = require('util'),
			exec = util.promisify(require('child_process').exec),
			{ stdout } = await exec(
				`git diff origin/${targetBranch}... --name-only --diff-filter=d`
			);
		return stdout.trim().split('\n');
	},
	eslint = async () => {
		const partialLinting = process.env.PARTIAL_LINTING; //false
		let files = ['.'];
		if (partialLinting && event.pull_request) {
			const branch = event.pull_request.base.ref;
			files = await getChangedFiles(branch);
		}
		const eslint = require('eslint'),
			cli = new eslint.CLIEngine(),
			report = cli.executeOnFiles(files),
			// fixableErrorCount, fixableWarningCount are available too
			levels = ['notice', 'warning', 'failure'];

		const annotations = report.results.reduce((annoList, result) => {
				const path = result.filePath.substring(GITHUB_WORKSPACE.length + 1);
				return annoList.concat(result.messages.map(m => {
					const singleLine = m.line === m.endLine || m.endLine === undefined;
					return {
						path,
						start_column: singleLine ? m.column : undefined,
						end_column: singleLine ? m.endColumn || m.column : undefined,
						start_line: m.line,
						end_line: m.endLine || m.line,
						annotation_level: levels[m.severity],
						// title: `${ path }#L${ m.line }`,
						// raw_details: 'Nothing much',
						message: `${ m.ruleId }: ${ m.message }`
					};
				}));
			}, []),

			{
				errorCount, warningCount
			} = report;
		return {
			annotations,
			errorCount,
			warningCount
		};
	},
	updateCheck = async (id, opts = {}) =>
		await request(`https://api.github.com/repos/${ owner }/${ repo }/check-runs/${ id }`, {
			method: 'PATCH',
			headers,
			body: {
				name: checkName,
				head_sha: checkSha,
				...opts
			}
		}),
	updateChecks = async (id, {
		errorCount, warningCount, annotations
	}) => {
		const chunkSize = 50,
			chunksLength = Math.ceil(annotations.length / chunkSize);

		await Promise.all(new Array(chunksLength).fill().map((_, i) => updateCheck(id, {
			status: 'in_progress',
			output: {
				title: checkName,
				summary: `${ errorCount } error(s), ${ warningCount } warning(s) found`,
				annotations: annotations.slice(i * chunkSize, (i + 1) * chunkSize)
			}
		})));

		await updateCheck(id, {
			status: 'completed',
			completed_at: (new Date()).toISOString(),
			conclusion: errorCount > 0 ? 'failure' : 'success',
			output: {
				title: checkName,
				summary: `${ errorCount } error(s), ${ warningCount } warning(s) found`
			}
		});
	},
	run = async () => {
		const id = await createCheck();
		try {
			await updateChecks(id, await eslint());
		} catch (err) {
			await updateCheck(id, {
				conclusion: 'failure',
				status: 'completed',
				completed_at: (new Date()).toISOString(),
				output: {
					title: checkName,
					summary: `Error while performing the check: ${err.message}`
				}
			});
			exitWithError(err);
		}
	};

run().catch(exitWithError);

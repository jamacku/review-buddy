import { setFailed, setOutput } from '@actions/core';

import '@total-typescript/ts-reset';

import action from './action';
import { getOctokit } from './octokit';
import { getConfig } from './config';
import { ActionError } from './error';

const config = getConfig();
const octokit = getOctokit(config.token);

try {
  const status = await action(octokit, config);
  setOutput('status', status);
} catch (error) {
  let message: string;

  if (error instanceof Error) {
    message = error.message;
  } else {
    message = JSON.stringify(error);
  }

  if (error instanceof ActionError) {
    setOutput('status', message);
  }

  setFailed(message);
}

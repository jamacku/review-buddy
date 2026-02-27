import { setFailed, setOutput } from '@actions/core';

import '@total-typescript/ts-reset';

import action from './action';
import { getConfig } from './config';
import { ReviewBuddyError } from './error';
import { getOctokit } from './octokit';

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

  if (error instanceof ReviewBuddyError) {
    setOutput('status', message);
  }

  setFailed(message);
}

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const requireFromMcp = createRequire(path.join(workspaceRoot, 'ads-mcp-readonly', 'package.json'));
const azdev = requireFromMcp('azure-devops-node-api');
const baseUrl = (process.env.AZURE_DEVOPS_URL || '').replace(/\/$/, '');
const collection = process.env.AZURE_DEVOPS_COLLECTION || 'TPC_Region26';
const project = process.env.AZURE_DEVOPS_PROJECT || 'SY_CT_Projects';
const flaggedIds = [
  963809, 964001, 964031, 964041, 964686, 964752, 964985, 965153, 966080,
  966768, 967055, 967056, 967066, 967986, 968046, 968688, 968839, 968923, 969332
];
const targetName = 'GAO, Hai Tao';
const positiveControlId = 966080;
const pat = process.env.AZURE_DEVOPS_PAT;
if (!baseUrl || !pat) throw new Error('ADS configuration was not initialized by the launcher.');

const auth = azdev.getPersonalAccessTokenHandler(pat);
const api = await new azdev.WebApi(`${baseUrl}/${collection}`, auth).getWorkItemTrackingApi();
const current = await api.getWorkItem(positiveControlId, undefined, undefined, 2, project);
const assignedTo = current.fields?.['System.AssignedTo'];
const exactIdentity = assignedTo?.uniqueName || assignedTo?.descriptor || assignedTo?.id;
if (typeof exactIdentity !== 'string' || !exactIdentity) {
  throw new Error('Positive-control work item did not expose a resolvable identity key.');
}

async function runEverQuery(identity) {
  const wiql = [
    'SELECT [System.Id] FROM WorkItems',
    `WHERE [System.TeamProject] = '${project}' AND [System.WorkItemType] = 'Bug'`,
    `AND [System.Id] IN (${[positiveControlId, ...flaggedIds].join(', ')})`,
    `AND EVER [System.AssignedTo] = '${identity.replaceAll("'", "''")}'`,
    'ORDER BY [System.Id] ASC'
  ].join(' ');
  const result = await api.queryByWiql({ query: wiql }, { project }, false, 200);
  return (result.workItems || []).map(item => item.id);
}

let revisions = null;
let revisionShape = 'null';
try {
  revisions = await api.getRevisions(positiveControlId, 200, 0, 2, project);
  revisionShape = Array.isArray(revisions) ? 'array' : typeof revisions;
} catch {
  revisionShape = 'error';
}
const byDisplayName = await runEverQuery(targetName);
const byExactIdentity = await runEverQuery(exactIdentity);
const revisionAudit = [];
for (const id of flaggedIds) {
  try {
    const revisions = await api.getRevisions(id, 200, 0, 2, project);
    if (!Array.isArray(revisions)) {
      revisionAudit.push({ id, readable: false, matchedIdentityRevisionCount: null });
      continue;
    }
    const matchingRevisions = revisions.filter(revision => {
      const identity = revision.fields?.['System.AssignedTo'];
      return identity?.uniqueName === exactIdentity || identity?.descriptor === exactIdentity || identity?.id === exactIdentity;
    });
    const currentRevision = revisions.at(-1);
    revisionAudit.push({
      id,
      readable: true,
      revisionCount: revisions.length,
      matchedIdentityRevisionCount: matchingRevisions.length,
      matchingRevisionNumbers: matchingRevisions.map(revision => revision.rev),
      currentAssignedTo: currentRevision?.fields?.['System.AssignedTo']?.displayName || null
    });
  } catch {
    revisionAudit.push({ id, readable: false, matchedIdentityRevisionCount: null });
  }
}
console.log(JSON.stringify({
  positiveControl: {
    id: positiveControlId,
    currentAssignedToIsTarget: assignedTo.displayName?.trim().toLocaleLowerCase('en-US') === targetName.toLocaleLowerCase('en-US'),
    hasExactIdentityKey: true,
    revisionsShape: revisionShape,
    revisionCount: Array.isArray(revisions) ? revisions.length : null
  },
  flaggedCount: flaggedIds.length,
  matchedByDisplayName: byDisplayName.filter(id => flaggedIds.includes(id)),
  matchedByExactIdentity: byExactIdentity.filter(id => flaggedIds.includes(id)),
  positiveControlMatchedByDisplayName: byDisplayName.includes(positiveControlId),
  positiveControlMatchedByExactIdentity: byExactIdentity.includes(positiveControlId),
  revisionAudit
}, null, 2));

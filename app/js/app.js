import { store, initIntegration, pushHistory, setBanner, updateIntegration, ensureInterviewState, ensureOnboardingState, loadStore } from './store.js';
import { STATUS, PERIODS, COMMISSION_RATE, CONVERSATIONS_PER_BUYER, MINUTES_PER_CONVERSATION, DAYS_PER_WEEK, INTERVIEW_STATUS, ONBOARDING_STATUS, HELP_MAP, DOC_REQUIREMENTS } from './constants.js';
import { navigate, setRenderer } from './router.js';
import { validateMobile, cleanMobile, validatePan, validateEmail, formatTs, pretty, nextRetryTime } from './helpers.js';
import {
  loadFlagsFromQuery,
  MOCK_FLAGS,
  createCandidate,
  startOrchestration,
  runNsdl,
  runIrdai,
  runCkyc,
  runDigiLocker,
  shareNat,
  getNatStatus,
  resolveBh,
  createInterviewTask,
  notifyBh,
  scheduleInterview,
  markInterviewStatus,
  recordInterviewOutcome,
  fetchCkycPrefill,
  fetchDigiLockerPrefill,
  shareOnboardingForm,
  scheduleRetry,
  renderDebugFlags
} from './mockApi.js';

loadStore();
if (store.candidate) {
  ensureInterviewState();
  ensureOnboardingState();
}
loadFlagsFromQuery();

const root = document.getElementById('root');
const overlay = document.getElementById('shareOverlay');
const shareStatus = document.getElementById('shareStatus');
const closeShare = document.getElementById('closeShare');

function getScenario(stage, code) {
  return HELP_MAP?.[stage]?.[code] || null;
}

closeShare.addEventListener('click', () => {
  overlay.classList.remove('active');
  store.ui.shareSheet = false;
});

overlay.addEventListener('click', (e) => {
  if (e.target === overlay) {
    overlay.classList.remove('active');
    store.ui.shareSheet = false;
  }
});

Array.from(overlay.querySelectorAll('[data-channel]')).forEach(btn => {
  btn.addEventListener('click', () => {
    shareStatus.textContent = 'Sending via ' + btn.dataset.channel + '...';
    setTimeout(() => {
      const success = Math.random() > 0.2;
      if (success) {
        shareStatus.textContent = 'Shared successfully via ' + btn.dataset.channel.toUpperCase();
        pushHistory({ ts: new Date().toISOString(), actor: 'DM', type: 'PDF_SHARED', outcome: 'SUCCESS', details: { channel: btn.dataset.channel } });
      } else {
        shareStatus.textContent = 'Failed to share. Try again.';
        pushHistory({ ts: new Date().toISOString(), actor: 'DM', type: 'PDF_SHARED', outcome: 'FAIL', details: { channel: btn.dataset.channel } });
      }
    }, 700);
  });
});

function renderBanner() {
  if (!store.ui.banner) return '';
  const { type, message } = store.ui.banner;
  const cls = type === 'error' ? 'banner error' : type === 'success' ? 'banner success' : 'banner info';
  return `<div class="${cls}">${message}</div>`;
}

function renderStageNav() {
  const stages = [
    { id: 0, label: 'Lead' },
    { id: 1, label: 'Profile build' },
    { id: 2, label: 'Readiness' },
    { id: 3, label: 'Interview' },
    { id: 4, label: 'Onboarding' }
  ];
  const allowOnboarding = store.candidate?.interviewOutcome?.outcome === 'PASS';
  const items = stages.map(s => {
    const completed = store.ui.screen > s.id;
    const gated = s.id === 4 && !allowOnboarding;
    return `<button class="stage-btn ${store.ui.screen === s.id ? 'active' : ''} ${completed ? 'completed' : ''}" data-screen="${s.id}" ${gated ? 'aria-disabled="true"' : ''}>${completed ? '<span class="check">✔</span>' : '<span class="check"></span>'}<span>${s.label}</span></button>`;
  }).join('');
  return `<div class="stage-nav">${items}</div>`;
}

function integrationMeaning(key, payload) {
  switch (key) {
    case 'NSDL': return payload?.panValid ? 'PAN is valid and active' : 'PAN validity pending';
    case 'IRDAI': return payload?.eligible ? 'No insurer conflicts found' : 'Not eligible with IRDAI';
    case 'CKYC': return payload?.ckycFound ? 'CKYC profile found' : 'CKYC not found';
    case 'DIGILOCKER': return payload?.available ? 'Documents available' : 'No DigiLocker docs';
    default: return '';
  }
}

function renderIntegrationCard(key, title) {
  const data = store.integrations[key] || { status: STATUS.NOT_STARTED };
  const status = data.status || STATUS.NOT_STARTED;
  const badgeClass = status === STATUS.SUCCESS ? 'SUCCESS' : status === STATUS.FAILED ? 'FAILED' : status === STATUS.PARTIAL ? 'PARTIAL' : 'PENDING';
  const badge = `<span class="badge ${badgeClass}">${badgeClass === 'FAILED' ? 'Attention' : badgeClass}</span>`;
  const nextRetry = data.nextRetryAt ? `<span class="small">Retry at ${formatTs(data.nextRetryAt)}</span>` : '';
  const meaning = integrationMeaning(key, data.payload);
  const payload = data.payload && Object.keys(data.payload).length ? `<pre class="expandable">${pretty(data.payload)}</pre>` : '<div class="expandable">No technical details</div>';
  const retryBtn = status === STATUS.FAILED ? `<button class="btn btn-secondary" data-retry="${key}">Retry</button>` : '';
  const helpBtn = status === STATUS.FAILED ? `<button class="btn btn-text" data-help-stage="profile" data-help-code="${key}">Need help?</button>` : '';
  const msg = data.message || meaning || 'Waiting for response';
  return `<div class="card integration-card" data-card="${key}">
    <div class="card-header"><div class="card-title">${title}</div>${badge}</div>
    <div class="status-block">
      <span>${meaning || 'Will update once received.'}</span>
      <span class="small">${msg}</span>
      ${nextRetry}
    </div>
    <button class="btn btn-text" data-toggle="${key}">View technical details</button>
    <div class="payload" style="display:none;">${payload}</div>
    <div style="margin-top:8px; display:flex; gap:8px;">${retryBtn}${helpBtn}</div>
  </div>`;
}

function renderScreen0() {
  const c = store.candidate;
  const mobile = c?.mobile || '';
  return `<div class="header"><h1>Lead Initiation</h1><p class="sub">Verify details to build candidate profile</p></div>
  ${renderBanner()}
  <div class="card">
    <div class="form-grid">
      <div>
        <label>Mobile Number</label>
        <input id="mobile" placeholder="10-digit mobile" value="${mobile}" />
      </div>
      <div>
        <label>PAN</label>
        <input id="pan" placeholder="ABCDE1234F" maxlength="10" value="${c?.pan || ''}" />
      </div>
      <div>
        <label>Email (optional)</label>
        <input id="email" placeholder="name@email.com" value="${c?.email || ''}" />
      </div>
    </div>
  </div>
  ${renderDebugFlags()}
  <div class="footer-spacer"></div>
  <div class="sticky-footer"><div class="content"><button class="btn btn-primary" id="verifyBtn">Verify & Build Profile</button></div></div>`;
}

async function handleIntegration(key, runner, payload) {
  const existing = store.integrations[key] || { key };
  updateIntegration(key, {
    ...existing,
    status: STATUS.PENDING,
    message: 'Running...',
    failureType: null,
    lastAttemptAt: new Date().toISOString(),
    attemptCount: (existing.attemptCount || 0) + 1,
  });
  render();
  try {
    const res = await runner(payload);
    if (res.failureType) {
      const scenario = getScenario('profile', `${key}_FAIL`);
      const msg = scenario?.userMessage || res.message || 'Failed';
      updateIntegration(key, {
        status: STATUS.FAILED,
        failureType: res.failureType,
        message: msg,
        payload: res,
        nextRetryAt: res.failureType === 'SYSTEM' ? nextRetryTime(existing.attemptCount || 0) : null
      });
      pushHistory({ ts: new Date().toISOString(), actor: 'SYSTEM', type: `${key}_FAIL`, outcome: 'FAIL', details: res });
      if (res.failureType === 'SYSTEM' && (existing.attemptCount || 0) < 3) {
        scheduleRetry(key, existing.attemptCount || 0, () => handleIntegration(key, runner, payload));
      }
    } else {
      let status = STATUS.SUCCESS;
      if (key === 'CKYC' && res.documents?.some(d => !d.available)) status = STATUS.PARTIAL;
      updateIntegration(key, {
        status,
        message: 'Completed',
        payload: res,
        nextRetryAt: null,
      });
      pushHistory({ ts: new Date().toISOString(), actor: 'SYSTEM', type: `${key}_SUCCESS`, outcome: 'SUCCESS', details: res });
    }
  } catch (e) {
    updateIntegration(key, { status: STATUS.FAILED, failureType: 'SYSTEM', message: e.message, payload: {} });
    pushHistory({ ts: new Date().toISOString(), actor: 'SYSTEM', type: `${key}_FAIL`, outcome: 'FAIL', details: { error: e.message } });
    const next = nextRetryTime(existing.attemptCount || 0);
    if (next) {
      updateIntegration(key, { nextRetryAt: next });
      setTimeout(() => handleIntegration(key, runner, payload), (new Date(next).getTime() - Date.now()));
    }
  }
  render();
}

async function startIntegrations() {
  const cand = store.candidate;
  ['NSDL','IRDAI','CKYC','DIGILOCKER'].forEach(key => updateIntegration(key, initIntegration(key)));
  pushHistory({ ts: new Date().toISOString(), actor: 'SYSTEM', type: 'ORCHESTRATION_STARTED', outcome: 'INFO', details: {} });
  render();
  await startOrchestration(cand.id);
  handleIntegration('NSDL', runNsdl, cand.pan);
  handleIntegration('IRDAI', runIrdai, cand.pan);
  handleIntegration('CKYC', runCkyc, { pan: cand.pan, mobile: cand.mobile });
  handleIntegration('DIGILOCKER', runDigiLocker, { mobile: cand.mobile });
}

function eligibilityStatus() {
  const nsdl = store.integrations.NSDL;
  const irdai = store.integrations.IRDAI;
  if (!nsdl || !irdai || nsdl.status !== STATUS.SUCCESS || irdai.status !== STATUS.SUCCESS) return { ok: false, reason: 'Waiting for checks' };
  if (!nsdl.payload.panValid) return { ok: false, reason: 'PAN invalid' };
  if (!irdai.payload.eligible) return { ok: false, reason: 'IRDAI not eligible' };
  return { ok: true, reason: 'Eligible to proceed' };
}

// duplicate definitions removed

function renderIntegrationRail() {
  const cards = [
    renderIntegrationCard('NSDL', 'PAN verified'),
    renderIntegrationCard('IRDAI', 'IRDAI check'),
    renderIntegrationCard('CKYC', 'CKYC details'),
    renderIntegrationCard('DIGILOCKER', 'DigiLocker docs'),
  ].join('');
  return `<div class="integration-grid">${cards}</div>`;
}

function resolvedName() {
  const c = store.candidate;
  if (!c) return 'Name pending';
  const ckycName = store.integrations.CKYC?.payload?.profile?.fullName;
  if (ckycName && store.integrations.CKYC?.status === STATUS.SUCCESS) return ckycName;
  if (c.name) return c.name;
  const nsdlName = store.integrations.NSDL?.payload?.nameOnPan;
  if (nsdlName) return nsdlName;
  return 'Name pending';
}

function renderCandidateCard() {
  const c = store.candidate;
  if (!c) return '';
  const name = resolvedName();
  return `<div class="card profile-card">
    <div class="summary-line"><strong>${name}</strong><span class="badge-block">Code <strong>${c.code}</strong> <button class="btn btn-text" id="copyCode" aria-label="Copy code">📋</button></span></div>
    <div class="table-ish">
      <span>Mobile</span><strong>${c.mobile}</strong>
      <span>PAN</span><strong>${c.pan}</strong>
      <span>Email</span><strong>${c.email || '-'}</strong>
      <span>Current step</span><strong>${c.currentState || 'Verifying identity'}</strong>
    </div>
  </div>`;
}

function renderScreen1() {
  const elig = eligibilityStatus();
  const banner = elig.ok ? `<div class="banner success">Eligible to proceed</div>` : `<div class="banner ${elig.reason.includes('Waiting') ? 'info' : 'error'}">${elig.reason}</div>`;
  const proceedDisabled = !elig.ok;
  return `<div class="header"><h1>Verification progress</h1><p class="sub">Verifying identity with official sources</p></div>
    ${renderCandidateCard()}
    ${banner}
    ${renderIntegrationRail()}
    <div class="footer-spacer"></div>
    <div class="sticky-footer"><div class="content"><button class="btn btn-primary" id="toReadiness" ${proceedDisabled ? 'disabled' : ''}>Proceed to Readiness Signals</button></div></div>`;
}

function renderNatCard() {
  const nat = store.readiness.nat;
  const integ = store.integrations.NAT_DELIVERY || { status: STATUS.NOT_STARTED };
  const nextRetry = integ.nextRetryAt ? `<div class="small">Next retry at ${formatTs(integ.nextRetryAt)}</div>` : '';
  return `<div class="card">
    <div class="card-header"><div class="card-title">NAT</div><span class="badge ${integ.status || STATUS.NOT_STARTED}">${integ.status || STATUS.NOT_STARTED}</span></div>
    <div class="status-line">
      <span>Email: ${store.candidate?.email || '-'}</span>
      <span>Mobile: ${store.candidate?.mobile || '-'}</span>
      <span>Last shared: ${nat.lastSharedAt ? formatTs(nat.lastSharedAt) : 'Never shared'}</span>
      <span>Delivery: ${integ.status === STATUS.SUCCESS ? 'Success' : integ.status === STATUS.FAILED ? 'Failed' : 'Unknown'}</span>
      <span>Completion: ${nat.completed ? 'Completed' : 'Not completed'}</span>
      <span>Score: ${nat.score ?? '-'}</span>
      ${nextRetry}
    </div>
    <div style="margin-top:8px; display:flex; gap:8px;">
      <button class="btn btn-secondary" id="shareNat">${nat.lastSharedAt ? 'Reshare NAT Link' : 'Share NAT Link'}</button>
      <button class="btn btn-text" id="checkNat">Refresh status</button>
    </div>
  </div>`;
}

function renderP50Card() {
  const p50 = store.readiness.p50;
  const uploadInfo = p50.upload ? `<div class="upload-preview">${p50.upload.previewUrl ? `<img src="${p50.upload.previewUrl}" alt="preview" />` : ''}<div class="small">${p50.upload.name}</div></div>` : '<div class="small">No upload yet</div>';
  return `<div class="card">
    <div class="card-header"><div class="card-title">P-50</div></div>
    <div class="form-grid two">
      <div>
        <label>Lead Count</label>
        <input id="leadCount" type="number" min="0" value="${p50.leadCount ?? ''}" />
      </div>
      <div style="display:flex; align-items:flex-end; gap:8px;">
        <input id="p50Complete" type="checkbox" ${p50.completed ? 'checked' : ''} /> <label for="p50Complete">Mark completed</label>
      </div>
      <div>
        <label>Upload evidence (jpg/png/pdf)</label>
        <div class="upload-tile" id="uploadTile">Tap to upload</div>
        ${uploadInfo}
        <input type="file" id="uploadInput" accept="image/*,.pdf" style="display:none;" />
      </div>
    </div>
    <p class="small">Upload is mandatory if lead count entered or marked completed.</p>
  </div>`;
}

function renderIncomeCard() {
  const inc = store.readiness.incomePlan;
  const derived = inc.derived || {};
  return `<div class="card">
    <div class="card-header"><div class="card-title">Income Planning</div></div>
    <div class="form-grid two">
      <div>
        <label>Desired earning</label>
        <input id="earnAmount" type="number" min="0" value="${inc.earnAmount ?? ''}" />
      </div>
      <div>
        <label>Period</label>
        <div class="segmented" id="periodSeg">${PERIODS.map(p => {
          const labels = { MONTHLY: 'Monthly', QUARTERLY: 'Quarterly', ANNUAL: 'Annual' };
          return `<button data-period="${p}" class="${inc.earnPeriod===p?'active':''}">${labels[p]}</button>`;
        }).join('')}</div>
      </div>
      <div>
        <label>Average Ticket Size (ATS)</label>
        <input id="ats" type="number" min="0" value="${inc.ats ?? ''}" />
      </div>
      <div>
        <label>Conversion %</label>
        <input id="conv" type="number" min="1" max="100" value="${inc.conversionPct ?? ''}" />
      </div>
    </div>
    <div class="divider"></div>
    <div class="table-ish">
      <span>Policies / month</span><strong>${derived.policiesPerMonth ?? '-'}</strong>
      <span>Premium / month</span><strong>${derived.premiumPerMonth ?? '-'}</strong>
      <span>Leads / month</span><strong>${derived.leadsPerMonth ?? '-'}</strong>
      <span>Leads / week</span><strong>${derived.leadsPerWeek ?? '-'}</strong>
      <span>Connects / month</span><strong>${derived.connectsPerMonth ?? '-'}</strong>
      <span>Time / week</span><strong>${derived.hoursPerWeek ?? '-'}</strong>
      <span>Time / day</span><strong>${derived.hoursPerDay ?? '-'}</strong>
    </div>
    <div style="margin-top:10px; display:flex; gap:8px;">
      <button class="btn btn-secondary" id="savePdf">Save Income Plan</button>
      <button class="btn btn-text" id="sharePdf" ${inc.pdf.generatedAt ? '' : 'disabled'}>Share PDF</button>
    </div>
    ${inc.pdf.generatedAt ? `<p class="small">PDF generated at ${formatTs(inc.pdf.generatedAt)}</p>` : ''}
  </div>`;
}

function renderScreen2() {
  return `<div class="header"><h1>Readiness Signals</h1><p class="sub">Share tools (non-gating)</p></div>
    ${renderBanner()}
    ${renderNatCard()}
    ${renderP50Card()}
    ${renderIncomeCard()}
    <div class="footer-spacer"></div>
    <div class="sticky-footer"><div class="content"><button class="btn btn-primary" id="toInterview">Proceed to Career Interview</button></div></div>`;
}

function renderScreen3() {
  const bh = store.integrations.BH_MAP;
  const task = store.integrations.INTERVIEW_TASK;
  const notify = store.integrations.BH_NOTIFY;
  const mappingOk = bh && bh.status === STATUS.SUCCESS;
  ensureInterviewState();
  const banner = bh && bh.status === STATUS.FAILED ? `<div class="banner error">${bh.message} <a href="#" id="refreshBh">Refresh mapping</a> or <a href="#">Contact support</a></div>` : '';
  const interview = store.candidate?.interview || {};
  const outcome = store.candidate?.interviewOutcome || {};
  const proceedReady = outcome.outcome === 'PASS';
  const outcomeBanner = outcome.outcome === 'PASS'
    ? `<div class="banner success">Cleared to proceed</div>`
    : outcome.outcome ? `<div class="banner error">Action needed based on BH response</div>` : '';
  return `<div class="header"><h1>Career Interview</h1><p class="sub">BH coordination and outcomes</p></div>
    ${banner}
    <div class="card" id="scheduleCard">
      <div class="card-header"><div class="card-title">BH mapping</div><span class="badge ${bh?.status || STATUS.NOT_STARTED}">${bh?.status || STATUS.NOT_STARTED}</span></div>
      <div class="status-line">
        <span>Name: ${bh?.payload?.bhName || '-'}</span>
        <span>Branch: ${bh?.payload?.branch || '-'}</span>
        <span>Last attempt: ${formatTs(bh?.lastAttemptAt)}</span>
        ${bh?.nextRetryAt ? `<span class="small">Next retry at ${formatTs(bh.nextRetryAt)}</span>` : ''}
      </div>
    </div>
    <div class="card">
      <div class="card-header"><div class="card-title">Schedule interview</div><span class="badge ${task?.status || STATUS.NOT_STARTED}">${task?.status || STATUS.NOT_STARTED}</span></div>
      <p class="small">DM initiates the schedule; BH will receive the request and confirm offline.</p>
      <div class="form-grid two">
        <div>
          <label>Preferred date</label>
          <input type="date" id="scheduleDate" value="${interview.date || ''}" />
        </div>
        <div>
          <label>Time slot</label>
          <input id="timeSlot" placeholder="e.g., 10:00 - 11:00" value="${interview.slot || ''}" />
        </div>
      </div>
      <div class="status-line">
        <span>Status: ${task?.message || task?.status || STATUS.NOT_STARTED}</span>
        <span>Attempts: ${task?.attemptCount || 0}</span>
        <span>Delivery receipt: ${notify?.status === STATUS.SUCCESS ? 'Acknowledged' : notify?.status === STATUS.FAILED ? 'Not delivered' : 'Pending'}</span>
        ${notify?.lastAttemptAt ? `<span>Last notify: ${formatTs(notify.lastAttemptAt)}</span>` : ''}
        ${task?.nextRetryAt ? `<span class="small">Auto-retry at ${formatTs(task.nextRetryAt)}</span>` : ''}
      </div>
      <div class="action-bar">
        <button class="btn btn-primary" id="scheduleInterviewBtn" ${!mappingOk ? 'disabled' : ''}>Schedule interview</button>
        <button class="btn btn-secondary" id="notifyBh" ${!mappingOk ? 'disabled' : ''}>Send notification</button>
      </div>
    </div>
    <div class="card">
      <div class="card-header"><div class="card-title">Interview status</div></div>
      <div class="status-line">
        <span>Current: ${outcome.outcome ? 'Result received' : interview.status === INTERVIEW_STATUS.SCHEDULED ? 'Scheduled' : interview.status === INTERVIEW_STATUS.COMPLETED ? 'Completed' : 'Not scheduled'}</span>
        <span>Last updated: ${formatTs(interview.lastUpdatedAt)}</span>
        <span>BH outcome: ${outcome.outcome ? `${outcome.outcome} (${formatTs(outcome.receivedAt)})` : 'Awaiting BH response'}</span>
      </div>
      <div class="form-grid two">
        <div>
          <label>Outcome (from BH)</label>
          <select id="bhOutcome">
            <option value="">Select</option>
            ${['PASS','FAIL'].map(o => `<option value="${o}" ${outcome.outcome === o ? 'selected' : ''}>${o}</option>`).join('')}
          </select>
        </div>
        <div>
          <label>Notes (optional)</label>
          <textarea id="bhNotes" rows="2">${outcome.notes || ''}</textarea>
        </div>
      </div>
      <div class="action-bar">
        <button class="btn btn-secondary" id="recordOutcome">Log BH outcome</button>
      </div>
    </div>
    <div class="card">
      <div class="card-header"><div class="card-title">Next step</div></div>
      ${outcomeBanner || '<p class="small">Once BH confirms Pass, proceed to onboarding forms.</p>'}
      <div class="action-bar">
        <button class="btn btn-primary" id="proceedOnboarding" ${outcome.outcome === 'PASS' ? '' : 'disabled'}>Proceed to Onboarding</button>
        <button class="btn btn-secondary" id="openHelpInterview">Help</button>
      </div>
    </div>
    <div class="footer-spacer"></div>
    <div class="sticky-footer"><div class="content">
      <button class="btn btn-secondary" id="footerHelp">Help</button>
      <button class="btn btn-primary" id="footerPrimary" ${proceedReady ? '' : 'disabled'}>${proceedReady ? 'Proceed to onboarding' : 'Waiting for BH outcome'}</button>
    </div></div>`;
}

function fieldError(section, key) {
  return store.ui.onboardingErrors?.[section]?.[key] || '';
}

function onboardingFieldsSummary(ob) {
  const requiredCount = 22; // tally of all mandatory fields
  const filled = Object.values(ob.fields.personal).filter(Boolean).length
    + Object.values(ob.fields.education).filter(Boolean).length
    + Object.values(ob.fields.contact.currentAddress).filter(Boolean).length
    + Object.values(ob.fields.contact.permanentAddress).filter((v, k) => k !== 'sameAsCurrent').filter(Boolean).length
    + Object.values(ob.fields.bank).filter(Boolean).length
    + Object.values(ob.fields.nominee).filter(v => typeof v === 'boolean' ? v : Boolean(v)).length
    - (ob.fields.contact.permanentAddress.sameAsCurrent ? 1 : 0);
  return { filled, required: requiredCount, pending: Math.max(requiredCount - filled, 0) };
}

function renderDocChecklist(ob) {
  const fromCkyc = ob.docs.ckyc || [];
  const fromDigi = ob.docs.digilocker || [];
  const manualDocs = ob.docs.manual || {};
  const docTypeToCategory = {
    PHOTO: 'Recent Photograph',
    ADDRESS_PROOF: 'Resident Proof',
    EDUCATION_PROOF: 'Education Proof',
    BANK_PROOF: 'Bank Proof',
    AADHAAR: 'Age Proof',
    SIGNATURE: 'Signature'
  };
  const statusRow = (req) => {
    const matches = [...fromCkyc, ...fromDigi].filter(d => docTypeToCategory[d.type] === req.category);
    const manual = manualDocs[req.category];
    let status = 'Missing';
    let sourceText = 'Collect manually';
    let viewLink = '';
    if (manual?.uploaded) {
      status = 'Uploaded';
      sourceText = `Uploaded manually ${manual.uploadedAt ? `(${formatTs(manual.uploadedAt)})` : ''}`;
    } else if (matches.length) {
      const availableDoc = matches.find(d => d.available);
      const doc = availableDoc || matches[0];
      status = availableDoc ? 'Available' : 'Partial';
      sourceText = doc.source || 'Auto-fetch';
      viewLink = doc.link ? `<a href="${doc.link}" target="_blank">View</a>` : '';
    }
    const sampleText = req.sample?.replace(/"/g, '&quot;') || '';
    return `<div class="table-ish doc-row">
      <span>${req.category}<div class="small">Acceptable: ${req.options.join(', ')}</div></span><strong>${status}</strong>
      <span>Source</span><strong>${sourceText} ${viewLink}</strong>
      <span>Actions</span>
      <div class="action-bar">
        <button class="btn btn-secondary" data-doc-upload="${req.category}" ${manual?.uploaded ? 'disabled' : ''}>${manual?.uploaded ? 'Uploaded' : 'Upload'}</button>
        <button class="btn btn-text" data-doc-sample="${req.category}" data-sample="${sampleText}">Help (view sample)</button>
      </div>
    </div>`;
  };
  return `<div class="card">
    <div class="card-header"><div class="card-title">Document checklist</div></div>
    <p class="small">If integrations are missing items, collect them manually from the candidate.</p>
    ${DOC_REQUIREMENTS.map(statusRow).join('')}
  </div>`;
}

function renderOnboardingSummary(ob) {
  const personal = ob.fields.personal;
  const education = ob.fields.education;
  const contact = ob.fields.contact;
  const bank = ob.fields.bank;
  const nominee = ob.fields.nominee;
  return `<div class="card">
    <div class="card-header"><div class="card-title">Review summary</div></div>
    <div class="table-ish">
      <span>Name</span><strong>${personal.title} ${personal.firstName} ${personal.lastName}</strong>
      <span>DOB</span><strong>${personal.dob}</strong>
      <span>Gender</span><strong>${personal.gender}</strong>
      <span>Marital status</span><strong>${personal.maritalStatus}</strong>
      <span>Category</span><strong>${personal.category}</strong>
      <span>Father/Spouse</span><strong>${personal.relationTitle} ${personal.relationName}</strong>
    </div>
    <div class="divider"></div>
    <div class="table-ish">
      <span>Qualification</span><strong>${education.qualification}</strong>
      <span>Institution</span><strong>${education.institution}</strong>
      <span>Roll number</span><strong>${education.rollNumber}</strong>
      <span>Year of passing</span><strong>${education.passingYear}</strong>
    </div>
    <div class="divider"></div>
    <div class="table-ish">
      <span>Mobile</span><strong>${contact.mobile}</strong>
      <span>Email</span><strong>${contact.email}</strong>
      <span>Current Address</span><strong>${contact.currentAddress.line1}, ${contact.currentAddress.line2}, ${contact.currentAddress.city}, ${contact.currentAddress.state} ${contact.currentAddress.pincode}</strong>
      <span>Permanent Address</span><strong>${contact.permanentAddress.line1}, ${contact.permanentAddress.line2}, ${contact.permanentAddress.city}, ${contact.permanentAddress.state} ${contact.permanentAddress.pincode}</strong>
    </div>
    <div class="divider"></div>
    <div class="table-ish">
      <span>Account</span><strong>${bank.accountNumber}</strong>
      <span>IFSC</span><strong>${bank.ifsc}</strong>
      <span>Bank</span><strong>${bank.bankName}</strong>
      <span>Branch</span><strong>${bank.branch}</strong>
    </div>
    <div class="divider"></div>
    <div class="table-ish">
      <span>Nominee</span><strong>${nominee.name}</strong>
      <span>Relationship</span><strong>${nominee.relationship}</strong>
      <span>DOB</span><strong>${nominee.dob}</strong>
      <span>Declaration</span><strong>${nominee.declarationAccepted ? 'Accepted' : 'Pending'}</strong>
    </div>
  </div>`;
}

function renderOnboardingScreen() {
  if (!store.candidate) {
    return `<div class="header"><h1>Onboarding</h1><p class="sub">Complete mandatory details and share with candidate for review</p></div><div class="banner info">Create a candidate first.</div>`;
  }
  ensureInterviewState();
  ensureOnboardingState();
  const ob = store.candidate.onboarding;
  const outcome = store.candidate.interviewOutcome?.outcome;
  const gated = outcome !== 'PASS';
  const summary = onboardingFieldsSummary(ob);
  const prefillCkyc = ob.fetchStatus.ckyc;
  const prefillDigi = ob.fetchStatus.digilocker;
  const editingLocked = ob.status === ONBOARDING_STATUS.SHARED_FOR_REVIEW;
  const lockFields = gated || editingLocked;
  const banner = gated ? `<div class="banner error">Interview must be passed to proceed. Inputs are disabled. <button class="btn btn-text" id="helpOnboardingGate">Need help?</button></div>` : '';
  const shareSuccess = ob.status === ONBOARDING_STATUS.SHARED_FOR_REVIEW ? `<div class="banner success">Form shared with candidate for review.</div>` : '';
  const lockReason = editingLocked ? ' (locked after share)' : '';
  return `<div class="header"><h1>Onboarding</h1><p class="sub">Complete mandatory details and share with candidate for review</p></div>
    ${banner}
    ${shareSuccess}
    ${renderCandidateCard()}
    <div class="card">
      <div class="card-header"><div class="card-title">Fetch verified details</div></div>
      <p class="small">Use CKYC and DigiLocker to prefill verified data and reduce manual typing.</p>
      <div class="action-bar">
        <button class="btn btn-secondary" id="fetchCkyc" ${gated || editingLocked ? 'disabled' : ''}>Refresh CKYC data</button>
        <button class="btn btn-secondary" id="fetchDigi" ${gated || editingLocked ? 'disabled' : ''}>Refresh DigiLocker data</button>
      </div>
      <div class="status-line">
        <span>CKYC: ${prefillCkyc.status} ${prefillCkyc.message ? '- '+prefillCkyc.message : ''}</span>
        <span>Last attempt: ${formatTs(prefillCkyc.lastAttemptAt)} | Attempts: ${prefillCkyc.attemptCount}</span>
        <span>DigiLocker: ${prefillDigi.status} ${prefillDigi.message ? '- '+prefillDigi.message : ''}</span>
        <span>Last attempt: ${formatTs(prefillDigi.lastAttemptAt)} | Attempts: ${prefillDigi.attemptCount}</span>
        <span>Auto-filled: <strong>${summary.filled}</strong> / <strong>${summary.required}</strong> | Pending: ${summary.pending}</span>
        <span>Docs: CKYC ${ob.docs.ckyc?.length || 0} | DigiLocker ${ob.docs.digilocker?.length || 0}</span>
      </div>
    </div>
    <div class="card">
      <div class="card-header"><div class="card-title">Personal Details</div><span class="small">${summary.filled} / ${summary.required} completed</span></div>
      <div class="form-grid two">
        ${['title','firstName','middleName','lastName','dob','gender','maritalStatus','category','relationTitle','relationName'].map(key => {
          const labels = {
            title:'Title (Mr./Ms.)',firstName:'First Name',middleName:'Middle Name',lastName:'Last Name',dob:'DOB',gender:'Gender',maritalStatus:'Marital Status',category:'Category',relationTitle:'Father/Spouse Title',relationName:'Father/Spouse Name'
          };
          const type = key === 'dob' ? 'date' : 'text';
          const val = ob.fields.personal[key] || '';
          return `<div>
            <label>${labels[key]}</label>
            <input data-section="personal" data-field="${key}" type="${type}" value="${val}" ${lockFields ? 'disabled' : ''}/>
            ${fieldError('personal', key) ? `<div class="small" style="color:#b91c1c;">${fieldError('personal', key)}</div>` : ''}
          </div>`;
        }).join('')}
      </div>
    </div>
    <div class="card">
      <div class="card-header"><div class="card-title">Education Details</div></div>
      <div class="form-grid two">
        ${['qualification','institution','rollNumber','passingYear'].map(key => {
          const labels = {qualification:'Basic Qualification', institution:'Board/Institution Name', rollNumber:'Roll Number', passingYear:'Year of Passing'};
          return `<div>
            <label>${labels[key]}</label>
            <input data-section="education" data-field="${key}" value="${ob.fields.education[key] || ''}" ${lockFields ? 'disabled' : ''}/>
            ${fieldError('education', key) ? `<div class="small" style="color:#b91c1c;">${fieldError('education', key)}</div>` : ''}
          </div>`;
        }).join('')}
      </div>
    </div>
    <div class="card">
      <div class="card-header"><div class="card-title">Contact & Address</div></div>
      <div class="form-grid two">
        <div>
          <label>Mobile (locked)</label>
          <input data-section="contact" data-field="mobile" value="${ob.fields.contact.mobile || ''}" disabled />
        </div>
        <div>
          <label>Email</label>
          <input data-section="contact" data-field="email" value="${ob.fields.contact.email || ''}" ${lockFields ? 'disabled' : ''}/>
          ${fieldError('contact', 'email') ? `<div class="small" style="color:#b91c1c;">${fieldError('contact','email')}</div>` : ''}
        </div>
      </div>
      <div class="divider"></div>
      <h4>Current Address</h4>
      <div class="form-grid two">
        ${['line1','line2','city','state','pincode'].map(key => `<div><label>${key.toUpperCase()}</label><input data-section="currentAddress" data-field="${key}" value="${ob.fields.contact.currentAddress[key] || ''}" ${lockFields ? 'disabled' : ''}/> ${fieldError('currentAddress', key) ? `<div class="small" style="color:#b91c1c;">${fieldError('currentAddress', key)}</div>` : ''}</div>`).join('')}
      </div>
      <div style="margin:10px 0;">
        <input type="checkbox" id="sameAddress" ${ob.fields.contact.permanentAddress.sameAsCurrent ? 'checked' : ''} ${lockFields ? 'disabled' : ''}/> <label for="sameAddress">Same as current</label>
      </div>
      <h4>Permanent Address</h4>
      <div class="form-grid two">
        ${['line1','line2','city','state','pincode'].map(key => `<div><label>${key.toUpperCase()}</label><input data-section="permanentAddress" data-field="${key}" value="${ob.fields.contact.permanentAddress[key] || ''}" ${lockFields ? 'disabled' : ''}/> ${fieldError('permanentAddress', key) ? `<div class="small" style="color:#b91c1c;">${fieldError('permanentAddress', key)}</div>` : ''}</div>`).join('')}
      </div>
    </div>
    <div class="card">
      <div class="card-header"><div class="card-title">Bank Details${lockReason}</div></div>
      <div class="form-grid two">
        ${['accountNumber','ifsc','bankName','branch'].map(key => {
          const labels = {accountNumber:'Account Number', ifsc:'IFSC', bankName:'Bank Name', branch:'Branch'};
          return `<div>
            <label>${labels[key]}</label>
            <input data-section="bank" data-field="${key}" value="${ob.fields.bank[key] || ''}" ${lockFields ? 'disabled' : ''}/>
            ${fieldError('bank', key) ? `<div class="small" style="color:#b91c1c;">${fieldError('bank', key)}</div>` : ''}
          </div>`;
        }).join('')}
      </div>
    </div>
    <div class="card">
      <div class="card-header"><div class="card-title">Nominee & Declarations</div></div>
      <div class="form-grid two">
        ${['name','relationship','dob'].map(key => {
          const labels = {name:'Nominee Name', relationship:'Relationship', dob:'Nominee DOB/Age'};
          const type = key === 'dob' ? 'date' : 'text';
          return `<div>
            <label>${labels[key]}</label>
            <input data-section="nominee" data-field="${key}" type="${type}" value="${ob.fields.nominee[key] || ''}" ${lockFields ? 'disabled' : ''}/>
            ${fieldError('nominee', key) ? `<div class="small" style="color:#b91c1c;">${fieldError('nominee', key)}</div>` : ''}
          </div>`;
        }).join('')}
      </div>
      <div style="margin-top:10px;">
        <input type="checkbox" id="declaration" ${ob.fields.nominee.declarationAccepted ? 'checked' : ''} ${lockFields ? 'disabled' : ''}/> <label for="declaration">I confirm declarations are completed</label>
        ${fieldError('nominee', 'declarationAccepted') ? `<div class="small" style="color:#b91c1c;">${fieldError('nominee','declarationAccepted')}</div>` : ''}
      </div>
    </div>
    ${renderDocChecklist(ob)}
    ${store.ui.onboardingSummary ? `${renderOnboardingSummary(ob)}<div class=\"card\"><div class=\"card-header\"><div class=\"card-title\">Share channel</div></div><p class=\"small\">Send the filled form to the candidate for review.</p><div class=\"action-bar\"><button class=\"btn btn-secondary\" data-share-channel=\"whatsapp\">WhatsApp</button><button class=\"btn btn-secondary\" data-share-channel=\"sms\">SMS</button><button class=\"btn btn-secondary\" data-share-channel=\"email\">Email</button></div><div class=\"status-line\"><span>Status: ${ob.shareStatus.status}</span><span>Last shared: ${formatTs(ob.shareStatus.lastSharedAt)}</span><span>${ob.shareStatus.message || ''}</span></div></div>` : ''}
    <div class="card sim-card">
      <div class="card-header"><div class="card-title">Simulation controls</div><button class="btn btn-text" id="toggleSim">Show</button></div>
      <div class="table-ish sim-body" style="display:none;">
        ${Object.keys(MOCK_FLAGS).map(key => `<div>${key}</div><div><input type="checkbox" data-flag="${key}" ${MOCK_FLAGS[key] ? 'checked' : ''}/></div>`).join('')}
      </div>
    </div>
    <div class="footer-spacer"></div>
    <div class="sticky-footer"><div class="content">
      <button class="btn btn-secondary" id="saveOnboarding" ${gated || editingLocked ? 'disabled' : ''}>Save</button>
      <button class="btn btn-secondary" id="validateOnboarding" ${gated || editingLocked ? 'disabled' : ''}>Validate</button>
      <button class="btn btn-primary" id="shareOnboarding" ${gated ? 'disabled' : ''}>${editingLocked ? 'Re-share' : 'Share for review'}</button>
    </div></div>`;
}

export function render() {
  let html = '';
  switch (store.ui.screen) {
    case 0: html = renderScreen0(); break;
    case 1: html = renderScreen1(); break;
    case 2: html = renderScreen2(); break;
    case 3: html = renderScreen3(); break;
    case 4: html = renderOnboardingScreen(); break;
    default: html = '<p>Unknown screen</p>';
  }
  const modal = store.ui.modal?.type === 'natEmail' ? renderNatEmailModal() : '';
  const helpDrawer = renderHelpDrawer();
  root.innerHTML = `<div class="page-shell">${renderStageNav()}${html}${modal}${helpDrawer}</div>`;
  bindEvents();
}

function renderNatEmailModal() {
  return `<div class="overlay active" id="natModal">
    <div class="modal">
      <h3>Share NAT requires email</h3>
      <p class="muted">NAT needs both SMS and Email delivery. Please add an email to proceed.</p>
      <div style="margin:10px 0;"><label>Email</label><input id="natEmailInput" placeholder="name@email.com" /></div>
      <div style="display:flex; gap:8px; justify-content:flex-end;">
        <button class="btn btn-secondary" id="cancelNatModal">Cancel</button>
        <button class="btn btn-primary" id="saveNatEmail">Save & continue</button>
      </div>
    </div>
  </div>`;
}

function renderHelpDrawer() {
  if (!store.ui.help) return '';
  const { stage, errorCode } = store.ui.help;
  const scenario = getScenario(stage, errorCode);
  const tips = scenario?.tips || getHelpTips(stage, errorCode);
  return `<div class="drawer active" id="helpDrawer">
    <div class="drawer-header"><strong>Help / Troubleshooting</strong><button class="btn btn-text" id="closeHelp">Close</button></div>
    ${scenario?.userMessage ? `<div class="help-tip"><strong>Issue:</strong> ${scenario.userMessage}</div>` : ''}
    ${scenario?.whyRetry ? `<div class="help-tip"><strong>Why retry:</strong> ${scenario.whyRetry}</div>` : ''}
    ${scenario?.retryScheduleText ? `<div class="help-tip"><strong>Next steps:</strong> ${scenario.retryScheduleText}</div>` : ''}
    ${tips.map(t => `<div class="help-tip">${t}</div>`).join('')}
    <a href="#" class="btn btn-secondary" id="raiseTicket">Raise support ticket</a>
  </div>`;
}

function bindEvents() {
  document.querySelectorAll('.stage-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.getAttribute('aria-disabled') === 'true') return;
      navigate(Number(btn.dataset.screen));
    });
  });
  document.querySelectorAll('[data-help-stage]').forEach(btn => {
    btn.addEventListener('click', () => {
      store.ui.help = { stage: btn.dataset.helpStage, errorCode: btn.dataset.helpCode || 'general' };
      render();
    });
  });
  const copyCodeBtn = document.getElementById('copyCode');
  copyCodeBtn?.addEventListener('click', async () => {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(store.candidate?.code || '');
      setBanner('success', 'Candidate code copied');
      render();
    }
  });
  if (store.ui.modal?.type === 'natEmail') {
    const modal = document.getElementById('natModal');
    modal?.addEventListener('click', (e) => { if (e.target === modal) store.ui.modal = null, render(); });
    document.getElementById('cancelNatModal')?.addEventListener('click', () => { store.ui.modal = null; render(); });
    document.getElementById('saveNatEmail')?.addEventListener('click', async () => {
      const input = document.getElementById('natEmailInput');
      input.setCustomValidity('');
      if (!validateEmail(input.value)) { input.setCustomValidity('Enter a valid email'); input.reportValidity(); return; }
      store.candidate.email = input.value;
      store.readiness.nat.emailCapturedViaModal = true;
      store.ui.modal = null;
      await document.getElementById('shareNat')?.click();
    });
  }
  if (store.ui.help) {
    document.getElementById('closeHelp')?.addEventListener('click', () => { store.ui.help = null; render(); });
    document.getElementById('raiseTicket')?.addEventListener('click', (e) => {
      e.preventDefault();
      const ctx = store.ui.help;
      const code = store.candidate?.code || 'NA';
      alert(`Ticket placeholder\nStage: ${ctx?.stage}\nError: ${ctx?.errorCode}\nCandidate: ${code}`);
    });
  }
  if (store.ui.screen === 0) {
    const mobileEl = document.getElementById('mobile');
    const panEl = document.getElementById('pan');
    const emailEl = document.getElementById('email');
    const btn = document.getElementById('verifyBtn');
    const validateBtn = () => {
      const mobValid = validateMobile(mobileEl.value);
      const panValid = validatePan(panEl.value.toUpperCase());
      const emailValid = validateEmail(emailEl.value);
      btn.disabled = !(mobValid && panValid && emailValid);
    };
    [mobileEl, panEl, emailEl].forEach(el => el.addEventListener('input', () => {
      if (el === panEl) el.value = el.value.toUpperCase();
      validateBtn();
    }));
    validateBtn();
    const simToggle = document.getElementById('toggleSim');
    const simBody = document.querySelector('.sim-body');
    simToggle?.addEventListener('click', () => {
      const open = simBody.style.display === 'grid';
      simBody.style.display = open ? 'none' : 'grid';
      simToggle.textContent = open ? 'Show' : 'Hide';
    });
    document.querySelectorAll('[data-flag]').forEach(cb => {
      cb.addEventListener('change', () => {
        MOCK_FLAGS[cb.dataset.flag] = cb.checked;
      });
    });
    btn.addEventListener('click', async () => {
      setBanner(null);
      btn.disabled = true;
      try {
        const mobile = cleanMobile(mobileEl.value);
        const pan = panEl.value.toUpperCase();
        const email = emailEl.value;
        const candidate = await createCandidate({ mobile, pan, email });
        store.candidate = candidate;
        ensureInterviewState();
        ensureOnboardingState();
        pushHistory({ ts: new Date().toISOString(), actor: 'DM', type: 'CANDIDATE_CREATED', outcome: 'SUCCESS', details: candidate });
        await startIntegrations();
        navigate(1);
      } catch (e) {
        setBanner('error', e.message + ' Please retry or contact support.');
        btn.disabled = false;
      }
    });
  }
  if (store.ui.screen === 1) {
    document.querySelectorAll('[data-toggle]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.toggle;
        const card = document.querySelector(`[data-card="${key}"] .payload`);
        card.style.display = card.style.display === 'none' ? 'block' : 'none';
      });
    });
    document.querySelectorAll('[data-retry]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.retry;
        const cand = store.candidate;
        if (key === 'NSDL') handleIntegration('NSDL', runNsdl, cand.pan);
        if (key === 'IRDAI') handleIntegration('IRDAI', runIrdai, cand.pan);
        if (key === 'CKYC') handleIntegration('CKYC', runCkyc, { pan: cand.pan, mobile: cand.mobile });
        if (key === 'DIGILOCKER') handleIntegration('DIGILOCKER', runDigiLocker, { mobile: cand.mobile });
      });
    });
    const proceed = document.getElementById('toReadiness');
    proceed?.addEventListener('click', () => navigate(2));
  }
  if (store.ui.screen === 2) {
    const sendNat = async () => {
      if (!store.candidate?.email) {
        store.ui.modal = { type: 'natEmail' };
        render();
        return;
      }
      const integ = store.integrations.NAT_DELIVERY || { key: 'NAT_DELIVERY', attemptCount: 0 };
      updateIntegration('NAT_DELIVERY', { ...integ, status: STATUS.PENDING, lastAttemptAt: new Date().toISOString(), attemptCount: (integ.attemptCount||0)+1 });
      render();
      const res = await shareNat({ candidateId: store.candidate?.id });
      if (res.delivered) {
        updateIntegration('NAT_DELIVERY', { status: STATUS.SUCCESS, message: 'Delivered', payload: res, nextRetryAt: null });
        store.readiness.nat.lastSharedAt = new Date().toISOString();
        store.readiness.nat.delivered = true;
        pushHistory({ ts: new Date().toISOString(), actor: 'SYSTEM', type: 'NAT_SHARED', outcome: 'SUCCESS', details: res });
      } else {
        const failureType = res.failureType || 'SYSTEM';
        const scenario = getScenario('readiness', 'NAT_DELIVERY_FAIL');
        const msg = scenario?.userMessage || res.message || 'Failed';
        updateIntegration('NAT_DELIVERY', { status: STATUS.FAILED, failureType, message: msg, payload: res, nextRetryAt: failureType === 'SYSTEM' ? nextRetryTime(integ.attemptCount || 0) : null });
        store.readiness.nat.delivered = false;
        if (failureType === 'SYSTEM' && (integ.attemptCount || 0) < 3) {
          scheduleRetry('NAT_DELIVERY', integ.attemptCount || 0, () => sendNat());
        }
        store.ui.help = { stage: 'readiness', errorCode: 'NAT_DELIVERY_FAIL' };
      }
      render();
    };
    document.getElementById('shareNat').addEventListener('click', sendNat);
    document.getElementById('checkNat').addEventListener('click', async () => {
      const res = await getNatStatus({ candidateId: store.candidate?.id });
      store.readiness.nat.completed = res.completed;
      store.readiness.nat.score = res.score;
      render();
    });
    const leadInput = document.getElementById('leadCount');
    const uploadTile = document.getElementById('uploadTile');
    const uploadInput = document.getElementById('uploadInput');
    const completeCb = document.getElementById('p50Complete');
    completeCb?.addEventListener('change', () => { store.readiness.p50.completed = completeCb.checked; });
    leadInput.addEventListener('input', () => { store.readiness.p50.leadCount = Number(leadInput.value); });
    uploadTile.addEventListener('click', () => uploadInput.click());
    uploadInput.addEventListener('change', () => {
      const file = uploadInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        store.readiness.p50.upload = { name: file.name, type: file.type, size: file.size, previewUrl: file.type.startsWith('image') ? reader.result : null };
        render();
      };
      reader.readAsDataURL(file);
    });
    const earnEl = document.getElementById('earnAmount');
    const atsEl = document.getElementById('ats');
    const convEl = document.getElementById('conv');
    const applyCalc = () => {
      const income = Number(earnEl.value);
      const ats = Number(atsEl.value);
      const conv = Number(convEl.value);
      store.readiness.incomePlan.earnAmount = income;
      store.readiness.incomePlan.ats = ats;
      store.readiness.incomePlan.conversionPct = conv;
      computeIncome();
      render();
    };
    earnEl.addEventListener('input', applyCalc);
    atsEl.addEventListener('input', applyCalc);
    convEl.addEventListener('input', applyCalc);
    document.querySelectorAll('#periodSeg button').forEach(btn => btn.addEventListener('click', () => {
      store.readiness.incomePlan.earnPeriod = btn.dataset.period;
      computeIncome();
      render();
    }));
    document.getElementById('savePdf').addEventListener('click', () => {
      store.readiness.incomePlan.pdf = { generatedAt: new Date().toISOString(), urlMock: 'https://example.com/mock.pdf' };
      pushHistory({ ts: new Date().toISOString(), actor: 'DM', type: 'PDF_SAVED', outcome: 'SUCCESS', details: {} });
      render();
    });
    const shareBtn = document.getElementById('sharePdf');
    shareBtn.addEventListener('click', () => {
      if (shareBtn.disabled) return;
      overlay.classList.add('active');
      store.ui.shareSheet = true;
      shareStatus.textContent = 'Select a channel to share the plan.';
    });
    document.getElementById('toInterview').addEventListener('click', () => {
      const p50 = store.readiness.p50;
      if ((p50.leadCount > 0 || p50.completed) && !p50.upload) {
        setBanner('error', 'P-50 upload is required when lead count is entered or marked complete.');
        render();
        return;
      }
      ensureBhMapping();
      navigate(3);
    });
  }
  if (store.ui.screen === 3) {
    const refresh = document.getElementById('refreshBh');
    refresh?.addEventListener('click', (e) => { e.preventDefault(); ensureBhMapping(true); });
    document.getElementById('notifyBh')?.addEventListener('click', handleBhNotify);
    document.getElementById('scheduleInterviewBtn')?.addEventListener('click', handleSchedule);
    document.getElementById('recordOutcome')?.addEventListener('click', recordOutcomeFlow);
    document.getElementById('proceedOnboarding')?.addEventListener('click', () => {
      if (store.candidate?.interviewOutcome?.outcome !== 'PASS') return;
      pushHistory({ ts: new Date().toISOString(), actor: 'DM', type: 'PROCEED_ONBOARDING', outcome: 'INFO', details: { from: 'INTERVIEW' } });
      setBanner('success', 'Proceeding to onboarding forms.');
      navigate(4);
    });
    document.getElementById('openHelpInterview')?.addEventListener('click', () => { store.ui.help = { stage: 'interview', errorCode: 'INTERVIEW_SCHEDULE_FAIL' }; render(); });
    document.getElementById('footerHelp')?.addEventListener('click', () => { store.ui.help = { stage: 'interview', errorCode: 'INTERVIEW_SCHEDULE_FAIL' }; render(); });
    document.getElementById('footerPrimary')?.addEventListener('click', () => {
      if (store.candidate?.interviewOutcome?.outcome === 'PASS') {
        pushHistory({ ts: new Date().toISOString(), actor: 'DM', type: 'PROCEED_ONBOARDING', outcome: 'INFO', details: { from: 'INTERVIEW' } });
        setBanner('success', 'Proceeding to onboarding forms.');
        navigate(4);
      }
    });
  }
  if (store.ui.screen === 4) {
    ensureOnboardingState();
    maybeAutoPrefill();
    const ob = store.candidate.onboarding;
    document.getElementById('helpOnboardingGate')?.addEventListener('click', () => { store.ui.help = { stage: 'onboarding', errorCode: 'ONBOARDING_SHARE_FAIL' }; render(); });
    const simToggle = document.getElementById('toggleSim');
    const simBody = document.querySelector('.sim-body');
    simToggle?.addEventListener('click', () => {
      const open = simBody.style.display === 'grid';
      simBody.style.display = open ? 'none' : 'grid';
      simToggle.textContent = open ? 'Show' : 'Hide';
    });
    document.querySelectorAll('[data-flag]').forEach(cb => cb.addEventListener('change', () => { MOCK_FLAGS[cb.dataset.flag] = cb.checked; }));
    document.querySelectorAll('input[data-section]').forEach(inp => {
      inp.addEventListener('input', () => {
        const section = inp.dataset.section;
        const field = inp.dataset.field;
        if (section === 'personal' || section === 'education' || section === 'bank') {
          ob.fields[section][field] = inp.value;
          if (section === 'bank' && field === 'ifsc' && inp.value.length >= 5) {
            ob.fields.bank.bankName = 'Mock Bank';
            ob.fields.bank.branch = 'Main Branch';
            const bankNameEl = document.querySelector('input[data-section="bank"][data-field="bankName"]');
            const branchEl = document.querySelector('input[data-section="bank"][data-field="branch"]');
            if (bankNameEl) bankNameEl.value = ob.fields.bank.bankName;
            if (branchEl) branchEl.value = ob.fields.bank.branch;
          }
        } else if (section === 'contact') {
          ob.fields.contact[field] = inp.value;
        } else if (section === 'currentAddress') {
          ob.fields.contact.currentAddress[field] = inp.value;
        } else if (section === 'permanentAddress') {
          ob.fields.contact.permanentAddress[field] = inp.value;
        } else if (section === 'nominee') {
          ob.fields.nominee[field] = inp.type === 'checkbox' ? inp.checked : inp.value;
        }
      });
    });
    document.getElementById('sameAddress')?.addEventListener('change', (e) => {
      ob.fields.contact.permanentAddress.sameAsCurrent = e.target.checked;
      if (e.target.checked) {
        ob.fields.contact.permanentAddress = { ...ob.fields.contact.currentAddress, sameAsCurrent: true };
        render();
      }
    });
    document.getElementById('declaration')?.addEventListener('change', (e) => {
      ob.fields.nominee.declarationAccepted = e.target.checked;
    });
    document.getElementById('fetchCkyc')?.addEventListener('click', () => handlePrefill('ckyc'));
    document.getElementById('fetchDigi')?.addEventListener('click', () => handlePrefill('digi'));
    document.getElementById('saveOnboarding')?.addEventListener('click', () => {
      ob.status = ONBOARDING_STATUS.IN_PROGRESS;
      pushHistory({ ts: new Date().toISOString(), actor: 'DM', type: 'ONBOARDING_SAVED', outcome: 'SUCCESS', details: {} });
      render();
    });
    document.getElementById('validateOnboarding')?.addEventListener('click', () => {
      validateOnboarding(true);
      render();
    });
    document.getElementById('shareOnboarding')?.addEventListener('click', async () => {
      const ok = validateOnboarding(true);
      if (!ok.valid) { render(); return; }
      store.ui.onboardingSummary = true;
      render();
    });
    document.querySelectorAll('[data-share-channel]')?.forEach(btn => {
      btn.addEventListener('click', async () => {
        const channel = btn.dataset.shareChannel;
        await handleShareOnboarding(channel);
      });
    });
    document.querySelectorAll('[data-doc-sample]')?.forEach(btn => {
      btn.addEventListener('click', () => {
        const sample = btn.dataset.sample || 'Example reference not available.';
        alert(`Sample for ${btn.dataset.docSample}:\n${sample}`);
      });
    });
    document.querySelectorAll('[data-doc-upload]')?.forEach(btn => {
      btn.addEventListener('click', () => {
        const category = btn.dataset.docUpload;
        ob.docs.manual[category] = { uploaded: true, uploadedAt: new Date().toISOString() };
        pushHistory({ ts: new Date().toISOString(), actor: 'DM', type: 'DOC_UPLOADED_MANUAL', outcome: 'SUCCESS', details: { category } });
        setBanner('success', `${category} marked as uploaded manually.`);
        render();
      });
    });
  }
}

function getHelpTips(stage, errorCode) {
  const catalog = {
    lead: ['Check contact details are correct before proceeding.', 'Temporary issues often clear on retry.'],
    profile: ['If a check fails, wait for the auto-retry or use Retry now.', 'Confirm PAN and mobile are correct.'],
    readiness: ['Ensure email is added before sharing NAT.', 'You can resend after correcting contact info.'],
    interview: ['If scheduling fails, retry or contact support with BH details.', 'Confirm BH mapping is available.'],
    onboarding: ['Use refresh to pull CKYC/DigiLocker again if missing.', 'Ensure required fields are filled before share.']
  };
  const list = catalog[stage] || ['Follow on-screen instructions and retry.'];
  return list.map(t => `${t}${errorCode ? '' : ''}`);
}

function computeIncome() {
  const inc = store.readiness.incomePlan;
  const monthly = inc.earnPeriod === 'MONTHLY' ? inc.earnAmount : inc.earnPeriod === 'QUARTERLY' ? inc.earnAmount/3 : inc.earnAmount/12;
  if (!monthly || !inc.ats || !inc.conversionPct) { inc.derived = null; return; }
  const monthlyPremiumNeeded = monthly / COMMISSION_RATE;
  const policiesPerMonth = Math.max(1, Math.ceil(monthlyPremiumNeeded / inc.ats));
  const premiumPerMonth = policiesPerMonth * inc.ats;
  const leadsPerMonth = Math.ceil(policiesPerMonth / (inc.conversionPct/100));
  const leadsPerWeek = Math.ceil(leadsPerMonth / 4.33);
  const connectsPerMonth = leadsPerMonth * CONVERSATIONS_PER_BUYER;
  const minutesPerMonth = connectsPerMonth * MINUTES_PER_CONVERSATION;
  const hoursPerWeek = (minutesPerMonth/60)/4.33;
  const hoursPerDay = hoursPerWeek / DAYS_PER_WEEK;
  inc.derived = { monthly, monthlyPremiumNeeded, policiesPerMonth, premiumPerMonth, leadsPerMonth, leadsPerWeek, connectsPerMonth, hoursPerWeek: hoursPerWeek.toFixed(1), hoursPerDay: hoursPerDay.toFixed(1) };
}

function maybeAutoPrefill() {
  if (store.ui.autoPrefillDone) return;
  const ob = store.candidate?.onboarding;
  if (!ob) return;
  const ckycReady = store.integrations.CKYC?.status === STATUS.SUCCESS || store.integrations.CKYC?.status === STATUS.PARTIAL;
  const digiReady = store.integrations.DIGILOCKER?.status === STATUS.SUCCESS || store.integrations.DIGILOCKER?.status === STATUS.PARTIAL;
  if (ckycReady && ob.fetchStatus.ckyc.status === STATUS.NOT_STARTED) {
    handlePrefill('ckyc', { auto: true });
  }
  if (digiReady && ob.fetchStatus.digilocker.status === STATUS.NOT_STARTED) {
    handlePrefill('digi', { auto: true });
  }
  store.ui.autoPrefillDone = true;
}

async function ensureBhMapping(force=false) {
  const existing = store.integrations.BH_MAP;
  if (existing && existing.status === STATUS.SUCCESS && !force) return;
  updateIntegration('BH_MAP', { ...(existing||{key:'BH_MAP'}), status: STATUS.PENDING, lastAttemptAt: new Date().toISOString(), attemptCount: (existing?.attemptCount||0)+1 });
  render();
  const res = await resolveBh({ dmId: store.dm.id });
  if (res.failureType) {
    updateIntegration('BH_MAP', { status: STATUS.FAILED, failureType: res.failureType, message: res.message, payload: res });
    if (res.failureType === 'SYSTEM' && (existing?.attemptCount||0) <3) {
      scheduleRetry('BH_MAP', existing?.attemptCount||0, () => ensureBhMapping());
    }
  } else {
    updateIntegration('BH_MAP', { status: STATUS.SUCCESS, message: 'Mapped', payload: res, nextRetryAt: null });
    pushHistory({ ts: new Date().toISOString(), actor: 'SYSTEM', type: 'BH_MAPPED', outcome: 'SUCCESS', details: res });
  }
  render();
}

async function handleInterview(date, notes) {
  const taskExisting = store.integrations.INTERVIEW_TASK || { key: 'INTERVIEW_TASK', attemptCount: 0 };
  updateIntegration('INTERVIEW_TASK', { ...taskExisting, status: STATUS.PENDING, lastAttemptAt: new Date().toISOString(), attemptCount: (taskExisting.attemptCount||0)+1 });
  render();
  const res = await createInterviewTask({ candidateId: store.candidate?.id, bhId: store.integrations.BH_MAP?.payload?.bhId, interviewDate: date, notes });
  if (res.failureType) {
    updateIntegration('INTERVIEW_TASK', { status: STATUS.FAILED, failureType: res.failureType, message: res.message, payload: res });
    render();
    return;
  }
  ensureInterviewState();
  store.candidate.interview = { ...store.candidate.interview, date, notes, status: INTERVIEW_STATUS.SCHEDULED, lastUpdatedAt: new Date().toISOString() };
  updateIntegration('INTERVIEW_TASK', { status: STATUS.SUCCESS, message: 'Task created', payload: res, nextRetryAt: null });
  pushHistory({ ts: new Date().toISOString(), actor: 'SYSTEM', type: 'INTERVIEW_CREATED', outcome: 'SUCCESS', details: res });
  await handleBhNotify();
}

async function handleBhNotify() {
  const notifyExisting = store.integrations.BH_NOTIFY || { key: 'BH_NOTIFY', attemptCount: 0 };
  updateIntegration('BH_NOTIFY', { ...notifyExisting, status: STATUS.PENDING, lastAttemptAt: new Date().toISOString(), attemptCount: (notifyExisting.attemptCount||0)+1 });
  render();
  const res = await notifyBh({ bhId: store.integrations.BH_MAP?.payload?.bhId, candidateId: store.candidate?.id });
  if (res.failureType) {
    updateIntegration('BH_NOTIFY', { status: STATUS.FAILED, failureType: res.failureType, message: res.message, payload: res });
    if (res.failureType === 'SYSTEM' && (notifyExisting.attemptCount||0) <3) {
      scheduleRetry('BH_NOTIFY', notifyExisting.attemptCount||0, () => handleBhNotify());
    }
    render();
    return;
  }
  updateIntegration('BH_NOTIFY', { status: STATUS.SUCCESS, message: 'BH notified', payload: res, nextRetryAt: null });
  pushHistory({ ts: new Date().toISOString(), actor: 'SYSTEM', type: 'BH_NOTIFIED', outcome: 'SUCCESS', details: res });
  render();
}

async function handleSchedule() {
  const modeBtn = document.querySelector('#modeSeg button.active');
  const mode = modeBtn?.dataset.mode || 'TELEPHONIC';
  const date = document.getElementById('scheduleDate').value;
  const slot = document.getElementById('timeSlot').value;
  const notes = document.getElementById('scheduleNotes').value;
  if (!date || !slot) { alert('Pick date and time slot'); return; }
  const taskExisting = store.integrations.INTERVIEW_TASK || { key: 'INTERVIEW_TASK', attemptCount: 0 };
  updateIntegration('INTERVIEW_TASK', { ...taskExisting, status: STATUS.PENDING, lastAttemptAt: new Date().toISOString(), attemptCount: (taskExisting.attemptCount||0)+1, message: 'Scheduling...' });
  render();
  const res = await scheduleInterview({ candidateId: store.candidate?.id, mode, date, slot, notes });
  if (res.failureType) {
    const scenario = getScenario('interview', 'INTERVIEW_SCHEDULE_FAIL');
    updateIntegration('INTERVIEW_TASK', { status: STATUS.FAILED, failureType: res.failureType, message: scenario?.userMessage || res.message, payload: res, nextRetryAt: res.failureType === 'SYSTEM' ? nextRetryTime(taskExisting.attemptCount || 0) : null });
    if (res.failureType === 'SYSTEM' && (taskExisting.attemptCount||0) < 3) {
      scheduleRetry('INTERVIEW_TASK', taskExisting.attemptCount||0, () => handleSchedule());
    }
    store.ui.help = { stage: 'interview', errorCode: 'INTERVIEW_SCHEDULE_FAIL' };
    render();
    return;
  }
  ensureInterviewState();
  store.candidate.interview = { ...store.candidate.interview, mode, date, slot, notes, status: INTERVIEW_STATUS.SCHEDULED, lastUpdatedAt: new Date().toISOString() };
  updateIntegration('INTERVIEW_TASK', { status: STATUS.SUCCESS, message: 'Interview scheduled', payload: res, nextRetryAt: null });
  pushHistory({ ts: new Date().toISOString(), actor: 'DM', type: 'INTERVIEW_SCHEDULED', outcome: 'SUCCESS', details: res });
  await handleBhNotify();
  render();
}

async function updateInterviewStatusFlow(nextStatus) {
  ensureInterviewState();
  const taskExisting = store.integrations.INTERVIEW_TASK || { key: 'INTERVIEW_TASK', attemptCount: 0 };
  updateIntegration('INTERVIEW_TASK', { ...taskExisting, status: STATUS.PENDING, lastAttemptAt: new Date().toISOString(), attemptCount: (taskExisting.attemptCount||0)+1, message: `Marking ${nextStatus}` });
  render();
  const res = await markInterviewStatus({ candidateId: store.candidate?.id, status: nextStatus });
  if (res.failureType) {
    updateIntegration('INTERVIEW_TASK', { status: STATUS.FAILED, failureType: res.failureType, message: res.message, payload: res });
    if (res.failureType === 'SYSTEM' && (taskExisting.attemptCount||0) < 3) {
      scheduleRetry('INTERVIEW_TASK', taskExisting.attemptCount||0, () => updateInterviewStatusFlow(nextStatus));
    }
    render();
    return;
  }
  store.candidate.interview = { ...store.candidate.interview, status: nextStatus, lastUpdatedAt: res.updatedAt || new Date().toISOString() };
  updateIntegration('INTERVIEW_TASK', { status: STATUS.SUCCESS, message: `${nextStatus} saved`, payload: res, nextRetryAt: null });
  pushHistory({ ts: new Date().toISOString(), actor: 'DM', type: `INTERVIEW_${nextStatus}`, outcome: 'SUCCESS', details: res });
  render();
}

async function recordOutcomeFlow() {
  const outcomeVal = document.getElementById('bhOutcome').value;
  const reasonEl = document.getElementById('bhReason');
  const reason = reasonEl ? reasonEl.value : '';
  const notes = document.getElementById('bhNotes').value;
  if (!outcomeVal) { alert('Select an outcome'); return; }
  const reasonText = reason && reasonEl ? document.querySelector('#bhReason option:checked')?.textContent : '';
  const taskExisting = store.integrations.INTERVIEW_TASK || { key: 'INTERVIEW_TASK', attemptCount: 0 };
  updateIntegration('INTERVIEW_TASK', { ...taskExisting, status: STATUS.PENDING, lastAttemptAt: new Date().toISOString(), attemptCount: (taskExisting.attemptCount||0)+1, message: 'Recording BH response' });
  render();
  const res = await recordInterviewOutcome({ candidateId: store.candidate?.id, outcome: outcomeVal, reasonCode: reason, reasonText, notes });
  if (res.failureType) {
    updateIntegration('INTERVIEW_TASK', { status: STATUS.FAILED, failureType: res.failureType, message: res.message, payload: res });
    if (res.failureType === 'SYSTEM' && (taskExisting.attemptCount||0) < 3) {
      scheduleRetry('INTERVIEW_TASK', taskExisting.attemptCount||0, () => recordOutcomeFlow());
    }
    render();
    return;
  }
  ensureInterviewState();
  store.candidate.interviewOutcome = { outcome: outcomeVal, reasonCode: reason, reasonText, notes, receivedAt: res.receivedAt || new Date().toISOString() };
  updateIntegration('INTERVIEW_TASK', { status: STATUS.SUCCESS, message: 'Outcome captured', payload: res, nextRetryAt: null });
  pushHistory({ ts: new Date().toISOString(), actor: 'DM', type: 'BH_OUTCOME_RECORDED', outcome: 'SUCCESS', details: res });
  render();
}

function validateOnboarding(showMessages=false) {
  ensureOnboardingState();
  const ob = store.candidate.onboarding;
  const errors = {};
  const req = (section, key, label, value) => {
    if (!value) {
      errors[section] = errors[section] || {};
      errors[section][key] = `${label} is required`;
    }
  };
  const p = ob.fields.personal;
  ['title','firstName','middleName','lastName','dob','gender','maritalStatus','category','relationTitle','relationName'].forEach(k => req('personal', k, k.replace(/([A-Z])/g,' $1'), p[k]));
  const edu = ob.fields.education;
  ['qualification','institution','rollNumber','passingYear'].forEach(k => req('education', k, k, edu[k]));
  const contact = ob.fields.contact;
  req('contact','email','Email', contact.email);
  const cur = contact.currentAddress;
  ['line1','line2','city','state','pincode'].forEach(k => req('currentAddress', k, `Current ${k}`, cur[k]));
  const permAddr = contact.permanentAddress.sameAsCurrent ? contact.currentAddress : contact.permanentAddress;
  ['line1','line2','city','state','pincode'].forEach(k => req('permanentAddress', k, `Permanent ${k}`, permAddr[k]));
  const bank = ob.fields.bank;
  ['accountNumber','ifsc','bankName','branch'].forEach(k => req('bank', k, k, bank[k]));
  const nominee = ob.fields.nominee;
  ['name','relationship','dob'].forEach(k => req('nominee', k, k, nominee[k]));
  if (!nominee.declarationAccepted) {
    errors.nominee = errors.nominee || {};
    errors.nominee.declarationAccepted = 'Please confirm declaration';
  }
  const prevCompletion = { ...ob.sectionsCompletion };
  const sectionChecks = {
    personal: ['title','firstName','middleName','lastName','dob','gender','maritalStatus','category','relationTitle','relationName'],
    education: ['qualification','institution','rollNumber','passingYear'],
    contact: ['email', 'line1','line2','city','state','pincode','perm_line1','perm_line2','perm_city','perm_state','perm_pincode'],
    bank: ['accountNumber','ifsc','bankName','branch'],
    nominee: ['name','relationship','dob','declarationAccepted']
  };
  const perm = permAddr;
  const sectionValues = {
    personal: p,
    education: edu,
    contact: { ...contact.currentAddress, ...perm, email: contact.email, perm_line1: perm.line1, perm_line2: perm.line2, perm_city: perm.city, perm_state: perm.state, perm_pincode: perm.pincode },
    bank,
    nominee
  };
  Object.keys(sectionChecks).forEach(sec => {
    const complete = sectionChecks[sec].every(key => {
      const val = sectionValues[sec][key] !== undefined ? sectionValues[sec][key] : sectionValues[sec][key.replace('perm_','')];
      return !!val || val === true;
    });
    ob.sectionsCompletion[sec] = complete ? 1 : 0;
    if (complete && prevCompletion[sec] !== 1 && showMessages) {
      const ts = new Date().toISOString();
      ob.history.push({ ts, actor: 'DM', type: `ONBOARDING_${sec.toUpperCase()}_COMPLETED`, outcome: 'SUCCESS', details: {} });
      pushHistory({ ts, actor: 'DM', type: `ONBOARDING_${sec.toUpperCase()}_COMPLETED`, outcome: 'SUCCESS', details: {} });
    }
  });
  store.ui.onboardingErrors = showMessages ? errors : {};
  const valid = Object.keys(errors).length === 0;
  if (valid) ob.status = ONBOARDING_STATUS.IN_PROGRESS;
  return { valid, errors };
}

async function handlePrefill(source, opts = {}) {
  const auto = opts.auto || false;
  ensureOnboardingState();
  const ob = store.candidate.onboarding;
  const statusObj = ob.fetchStatus[source === 'ckyc' ? 'ckyc' : 'digilocker'];
  statusObj.status = STATUS.PENDING;
  statusObj.lastAttemptAt = new Date().toISOString();
  statusObj.attemptCount = (statusObj.attemptCount || 0) + 1;
  ob.history.push({ ts: statusObj.lastAttemptAt, actor: 'DM', type: `${source.toUpperCase()}_PREFILL_ATTEMPT`, outcome: 'INFO', details: {} });
  pushHistory({ ts: statusObj.lastAttemptAt, actor: 'DM', type: `${source.toUpperCase()}_PREFILL_ATTEMPT`, outcome: 'INFO', details: {} });
  render();
  const res = source === 'ckyc'
    ? await fetchCkycPrefill({ pan: store.candidate.pan, mobile: store.candidate.mobile })
    : await fetchDigiLockerPrefill({ mobile: store.candidate.mobile });
  if (res.failureType) {
    const code = source === 'ckyc' ? 'CKYC_FAIL' : 'DIGILOCKER_FAIL';
    const scenario = getScenario('profile', code);
    statusObj.status = STATUS.FAILED;
    statusObj.message = scenario?.userMessage || res.message;
    ob.history.push({ ts: new Date().toISOString(), actor: 'DM', type: `${source.toUpperCase()}_PREFILL_FAIL`, outcome: 'FAIL', details: res });
    pushHistory({ ts: new Date().toISOString(), actor: 'DM', type: `${source.toUpperCase()}_PREFILL_FAIL`, outcome: 'FAIL', details: res });
    store.ui.help = { stage: source === 'ckyc' ? 'profile' : 'profile', errorCode: code };
    render();
    return;
  }
  statusObj.status = STATUS.SUCCESS;
  statusObj.message = `${res.autoFilled} fields auto-filled${auto ? ' (auto)' : ''}`;
  if (source === 'ckyc') {
    ob.fields.personal = { ...ob.fields.personal, ...res.personal };
    ob.fields.contact.currentAddress = { ...ob.fields.contact.currentAddress, ...res.address };
    if (ob.fields.contact.permanentAddress.sameAsCurrent) {
      ob.fields.contact.permanentAddress = { ...ob.fields.contact.currentAddress, sameAsCurrent: true };
    }
    ob.docs.ckyc = res.docs;
  } else {
    ob.fields.education = { ...ob.fields.education, ...res.education };
    ob.fields.bank = { ...ob.fields.bank, ...res.bank };
    ob.docs.digilocker = res.docs;
  }
  ob.history.push({ ts: new Date().toISOString(), actor: 'DM', type: `${source.toUpperCase()}_PREFILL_SUCCESS`, outcome: 'SUCCESS', details: res });
  pushHistory({ ts: new Date().toISOString(), actor: 'DM', type: `${source.toUpperCase()}_PREFILL_SUCCESS`, outcome: 'SUCCESS', details: res });
  render();
}

async function handleShareOnboarding(channel) {
  ensureOnboardingState();
  const ob = store.candidate.onboarding;
  ob.shareStatus.status = STATUS.PENDING;
  ob.shareStatus.attempts = (ob.shareStatus.attempts || 0) + 1;
  ob.shareStatus.message = 'Sharing...';
  const attemptTs = new Date().toISOString();
  ob.history.push({ ts: attemptTs, actor: 'DM', type: 'ONBOARDING_SHARE_ATTEMPT', outcome: 'INFO', details: { channel } });
  pushHistory({ ts: attemptTs, actor: 'DM', type: 'ONBOARDING_SHARE_ATTEMPT', outcome: 'INFO', details: { channel } });
  render();
  const res = await shareOnboardingForm({ candidateId: store.candidate.id, channel });
  if (res.failureType) {
    ob.shareStatus.status = STATUS.FAILED;
    const scenario = getScenario('onboarding', 'ONBOARDING_SHARE_FAIL');
    ob.shareStatus.message = scenario?.userMessage || res.message;
    ob.history.push({ ts: new Date().toISOString(), actor: 'DM', type: 'ONBOARDING_SHARE_FAIL', outcome: 'FAIL', details: res });
    pushHistory({ ts: new Date().toISOString(), actor: 'DM', type: 'ONBOARDING_SHARE_FAIL', outcome: 'FAIL', details: res });
    store.ui.help = { stage: 'onboarding', errorCode: 'ONBOARDING_SHARE_FAIL' };
    render();
    return;
  }
  ob.shareStatus.status = STATUS.SUCCESS;
  ob.shareStatus.lastSharedAt = res.sharedAt;
  ob.shareStatus.channel = channel;
  ob.status = ONBOARDING_STATUS.SHARED_FOR_REVIEW;
  ob.history.push({ ts: new Date().toISOString(), actor: 'DM', type: 'ONBOARDING_SHARED', outcome: 'SUCCESS', details: res });
  pushHistory({ ts: new Date().toISOString(), actor: 'DM', type: 'ONBOARDING_SHARED', outcome: 'SUCCESS', details: res });
  store.ui.onboardingSummary = true;
  setBanner('success', 'Form shared with candidate for review.');
  render();
}

// initial render
setRenderer(render);
render();
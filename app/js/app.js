import { store, initIntegration, pushHistory, setBanner, updateIntegration, ensureInterviewState, ensureOnboardingState, loadStore } from './store.js';
import { STATUS, PERIODS, COMMISSION_RATE, CONVERSATIONS_PER_BUYER, MINUTES_PER_CONVERSATION, DAYS_PER_WEEK, INTERVIEW_STATUS, ONBOARDING_STATUS } from './constants.js';
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
    const muted = s.id === 4 && !allowOnboarding;
    return `<button class="stage-btn ${store.ui.screen === s.id ? 'active' : ''}" data-screen="${s.id}" ${muted ? 'aria-disabled="true"' : ''}>${s.label}</button>`;
  }).join('');
  return `<div class="stage-nav">${items}</div>`;
}

function renderIntegrationCard(key, title) {
  const data = store.integrations[key] || { status: STATUS.NOT_STARTED };
  const status = data.status || STATUS.NOT_STARTED;
  const badge = `<span class="badge ${status}">${status}</span>`;
  const nextRetry = data.nextRetryAt ? `<span class="small">Next retry at ${formatTs(data.nextRetryAt)}</span>` : '';
  const payload = data.payload && Object.keys(data.payload).length ? `<pre class="expandable">${pretty(data.payload)}</pre>` : '';
  const retryBtn = status === STATUS.FAILED ? `<button class="btn btn-secondary" data-retry="${key}">Retry</button>` : '';
  const msg = data.message || 'Awaiting response';
  return `<div class="card integration-card" data-card="${key}">
    <div class="card-header"><div class="card-title">${title}</div>${badge}</div>
    <div class="status-block">
      <span><strong>Last attempt:</strong> ${formatTs(data.lastAttemptAt)}</span>
      <span><strong>Message:</strong> ${msg}</span>
      ${nextRetry}
    </div>
    <button class="btn btn-text" data-toggle="${key}">View details</button>
    <div class="payload" style="display:none;">${payload || '<div class="expandable">No payload yet</div>'}</div>
    <div style="margin-top:8px; display:flex; gap:8px;">${retryBtn}</div>
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
      updateIntegration(key, {
        status: STATUS.FAILED,
        failureType: res.failureType,
        message: res.message || 'Failed',
        payload: res,
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

function renderIntegrationRail() {
  const cards = [
    renderIntegrationCard('NSDL', 'NSDL PAN Verification'),
    renderIntegrationCard('IRDAI', 'IRDAI Eligibility'),
    renderIntegrationCard('CKYC', 'CKYC Profile & Docs'),
    renderIntegrationCard('DIGILOCKER', 'DigiLocker Docs'),
  ].join('');
  return `<div class="integration-grid">${cards}</div>`;
}

function renderCandidateCard() {
  const c = store.candidate;
  if (!c) return '';
  return `<div class="card profile-card">
    <div class="summary-line"><strong>${c.name || 'Name TBD'}</strong><span class="badge-block">Candidate Code <strong>${c.code}</strong></span></div>
    <div class="table-ish">
      <span>Mobile</span><strong>${c.mobile}</strong>
      <span>PAN</span><strong>${c.pan}</strong>
      <span>Email</span><strong>${c.email || '-'}</strong>
      <span>State</span><strong>${c.currentState}</strong>
    </div>
  </div>`;
}

function renderScreen1() {
  const elig = eligibilityStatus();
  const banner = elig.ok ? `<div class="banner success">Eligible to proceed</div>` : `<div class="banner ${elig.reason.includes('Waiting') ? 'info' : 'error'}">${elig.reason}</div>`;
  const proceedDisabled = !elig.ok;
  return `<div class="header"><h1>Profile build status</h1><p class="sub">Verifying details from official sources</p></div>
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
        <div class="segmented" id="periodSeg">${PERIODS.map(p => `<button data-period="${p}" class="${inc.earnPeriod===p?'active':''}">${p}</button>`).join('')}</div>
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
  const ladder = [INTERVIEW_STATUS.SCHEDULED, INTERVIEW_STATUS.IN_PROGRESS, INTERVIEW_STATUS.COMPLETED];
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
        <span>Message: ${bh?.message || 'Pending'}</span>
        <span>Last attempt: ${formatTs(bh?.lastAttemptAt)}</span>
        ${bh?.nextRetryAt ? `<span class="small">Next retry at ${formatTs(bh.nextRetryAt)}</span>` : ''}
      </div>
    </div>
    <div class="card">
      <div class="card-header"><div class="card-title">Initiate interview task</div><span class="badge ${task?.status || STATUS.NOT_STARTED}">${task?.status || STATUS.NOT_STARTED}</span></div>
      <p class="small">Creates task for BH and captures the indicative date.</p>
      <div class="form-grid">
        <div>
          <label>Preferred interview date (indicative)</label>
          <input type="date" id="interviewDate" value="${interview.date || ''}" />
        </div>
        <div>
          <label>Notes (optional)</label>
          <textarea id="notes" rows="3">${interview.notes || ''}</textarea>
        </div>
      </div>
      <div class="divider"></div>
      <div class="status-block">
        <strong>Task status:</strong> <span class="badge ${task?.status || STATUS.NOT_STARTED}">${task?.status || STATUS.NOT_STARTED}</span>
        <span>${task?.message || ''}</span>
        <strong>Notification:</strong> <span class="badge ${notify?.status || STATUS.NOT_STARTED}">${notify?.status || STATUS.NOT_STARTED}</span>
        ${notify?.nextRetryAt ? `<span class="small">Next retry at ${formatTs(notify.nextRetryAt)}</span>` : ''}
      </div>
      <div class="action-bar">
        <button class="btn btn-primary" id="initiateInterview" ${!mappingOk ? 'disabled' : ''}>Initiate Career Interview</button>
        <button class="btn btn-secondary" id="notifyBh" ${!mappingOk ? 'disabled' : ''}>Send notification to BH</button>
      </div>
    </div>
    <div class="card">
      <div class="card-header"><div class="card-title">Schedule / Reschedule</div><span class="badge ${interview.status === INTERVIEW_STATUS.NOT_SCHEDULED ? STATUS.NOT_STARTED : STATUS.SUCCESS}">${interview.status === INTERVIEW_STATUS.NOT_SCHEDULED ? STATUS.NOT_STARTED : STATUS.SUCCESS}</span></div>
      <div class="form-grid two">
        <div>
          <label>Interview mode</label>
          <div class="segmented" id="modeSeg">
            <button data-mode="TELEPHONIC" class="${interview.mode === 'TELEPHONIC' ? 'active' : ''}">Telephonic</button>
            <button data-mode="F2F" class="${interview.mode === 'F2F' ? 'active' : ''}">F2F</button>
            <button data-mode="VIDEO" class="${interview.mode === 'VIDEO' ? 'active' : ''}">Video</button>
          </div>
        </div>
        <div>
          <label>Interview date</label>
          <input type="date" id="scheduleDate" value="${interview.date || ''}" />
        </div>
        <div>
          <label>Preferred time slot</label>
          <input id="timeSlot" placeholder="e.g., 10:00 - 11:00" value="${interview.slot || ''}" />
        </div>
        <div>
          <label>Notes to BH (optional)</label>
          <textarea id="scheduleNotes" rows="2">${interview.notes || ''}</textarea>
        </div>
      </div>
      <div class="status-line">
        <span>Status: <strong>${interview.status || INTERVIEW_STATUS.NOT_SCHEDULED}</strong></span>
        <span>Last updated: ${formatTs(interview.lastUpdatedAt)}</span>
      </div>
      <div class="action-bar">
        <button class="btn btn-primary" id="scheduleInterviewBtn" ${!mappingOk ? 'disabled' : ''}>Schedule / Reschedule</button>
        <button class="btn btn-secondary" id="nudgeBh" ${!mappingOk ? 'disabled' : ''}>Send notification to BH</button>
      </div>
    </div>
    <div class="card">
      <div class="card-header"><div class="card-title">Interview progress</div></div>
      <div class="timeline">
        ${ladder.map(step => `<li class="${interview.status === step ? 'active-step' : ''}"><strong>${step.replace(/_/g,' ')}</strong>${interview.status === step ? ' (current)' : ''}</li>`).join('')}
      </div>
      <div class="status-line">
        <span>Current: ${interview.status || INTERVIEW_STATUS.NOT_SCHEDULED}</span>
        <span>Last touched: ${formatTs(interview.lastUpdatedAt)}</span>
      </div>
      <div class="action-bar">
        <button class="btn btn-secondary" id="markInProgress" ${interview.status === INTERVIEW_STATUS.NOT_SCHEDULED ? 'disabled' : ''}>Mark In Progress</button>
        <button class="btn btn-primary" id="markCompleted" ${interview.status !== INTERVIEW_STATUS.IN_PROGRESS ? 'disabled' : ''}>Mark Completed</button>
      </div>
    </div>
    <div class="card">
      <div class="card-header"><div class="card-title">BH outcome received</div></div>
      <div class="form-grid two">
        <div>
          <label>Outcome</label>
          <select id="bhOutcome">
            <option value="">Select</option>
            ${['PASS','FAIL','HOLD','REWORK'].map(o => `<option value="${o}" ${outcome.outcome === o ? 'selected' : ''}>${o}</option>`).join('')}
          </select>
        </div>
        <div>
          <label>Reason (for Fail / Rework)</label>
          <select id="bhReason">
            <option value="">--</option>
            <option value="FIT">Fitment concerns</option>
            <option value="DOCS">Documentation pending</option>
            <option value="MOTIVATION">Motivation gap</option>
            <option value="AVAILABILITY">Availability issue</option>
          </select>
        </div>
        <div>
          <label>Notes (optional)</label>
          <textarea id="bhNotes" rows="2">${outcome.notes || ''}</textarea>
        </div>
      </div>
      <div class="status-line">
        <span>Last recorded: ${formatTs(outcome.receivedAt)}</span>
        <span>${outcome.outcome ? `Outcome: ${outcome.outcome}` : 'Awaiting BH response'}</span>
      </div>
      <div style="margin-top:8px; display:flex; gap:8px;">
        <button class="btn btn-primary" id="recordOutcome">Record BH Outcome</button>
      </div>
    </div>
    <div class="card">
      <div class="card-header"><div class="card-title">Next step</div></div>
      ${outcomeBanner || '<p class="small">Record BH outcome to unlock the next step.</p>'}
      <div class="action-bar">
        <button class="btn btn-primary" id="proceedOnboarding" ${outcome.outcome === 'PASS' ? '' : 'disabled'}>Proceed to OnBoarding (mandatory forms)</button>
        <button class="btn btn-secondary" id="rescheduleFromOutcome" ${outcome.outcome && outcome.outcome !== 'PASS' ? '' : 'disabled'}>Reschedule interview</button>
        <button class="btn btn-secondary" id="restartInterview" ${!outcome.outcome || outcome.outcome === 'PASS' ? 'disabled' : ''}>Restart interview flow</button>
      </div>
      <div class="status-line">
        ${outcome.outcome && outcome.outcome !== 'PASS' ? '<span>Need a fresh attempt? Reschedule above.</span>' : '<span>Ensure BH response is captured.</span>'}
      </div>
    </div>
    <div class="footer-spacer"></div>
    <div class="sticky-footer"><div class="content">
      <button class="btn btn-secondary" id="footerToSchedule">Schedule / Update</button>
      <button class="btn btn-primary" id="footerPrimary" ${proceedReady ? '' : ''}>${proceedReady ? 'Proceed to onboarding' : 'Record BH outcome'}</button>
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
  const requiredDocs = ['PHOTO', 'ADDRESS_PROOF', 'EDUCATION_PROOF', 'BANK_PROOF'];
  const fromCkyc = ob.docs.ckyc || [];
  const fromDigi = ob.docs.digilocker || [];
  const statusRow = (label, source) => {
    const available = [...fromCkyc, ...fromDigi].find(d => d.type === label);
    const status = available ? (available.available ? 'Available' : 'Partial') : 'Missing';
    const sourceText = available ? `${available.source}` : 'Collect manually';
    const viewLink = available?.link ? `<a href="${available.link}" target="_blank">View</a>` : '';
    return `<div class="table-ish">
      <span>${label.replace(/_/g,' ')}</span><strong>${status}</strong>
      <span>Source</span><strong>${sourceText} ${viewLink}</strong>
    </div>`;
  };
  return `<div class="card">
    <div class="card-header"><div class="card-title">Document checklist</div></div>
    <p class="small">Availability only; uploads are not in scope for this prototype.</p>
    ${requiredDocs.map(d => statusRow(d)).join('')}
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
  const banner = gated ? `<div class="banner error">Interview must be passed to proceed. Inputs are disabled.</div>` : '';
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
        <button class="btn btn-secondary" id="fetchCkyc" ${gated || editingLocked ? 'disabled' : ''}>Fetch from CKYC</button>
        <button class="btn btn-secondary" id="fetchDigi" ${gated || editingLocked ? 'disabled' : ''}>Fetch from DigiLocker</button>
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
  root.innerHTML = `<div class="page-shell">${renderStageNav()}${html}</div>`;
  bindEvents();
}

function bindEvents() {
  document.querySelectorAll('.stage-btn').forEach(btn => {
    btn.addEventListener('click', () => navigate(Number(btn.dataset.screen)));
  });
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
        updateIntegration('NAT_DELIVERY', { status: STATUS.FAILED, failureType, message: res.message || 'Failed', payload: res });
        store.readiness.nat.delivered = false;
        if (failureType === 'SYSTEM' && (integ.attemptCount || 0) < 3) {
          scheduleRetry('NAT_DELIVERY', integ.attemptCount || 0, () => sendNat());
        }
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
    document.getElementById('initiateInterview').addEventListener('click', async () => {
      const date = document.getElementById('interviewDate').value;
      const notes = document.getElementById('notes').value;
      if (!date) { alert('Select date'); return; }
      await handleInterview(date, notes);
    });
    document.getElementById('notifyBh')?.addEventListener('click', handleBhNotify);
    document.getElementById('scheduleInterviewBtn')?.addEventListener('click', handleSchedule);
    document.getElementById('nudgeBh')?.addEventListener('click', handleBhNotify);
    document.querySelectorAll('#modeSeg button').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#modeSeg button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        ensureInterviewState();
        store.candidate.interview.mode = btn.dataset.mode;
      });
    });
    document.getElementById('markInProgress')?.addEventListener('click', () => updateInterviewStatusFlow(INTERVIEW_STATUS.IN_PROGRESS));
    document.getElementById('markCompleted')?.addEventListener('click', () => updateInterviewStatusFlow(INTERVIEW_STATUS.COMPLETED));
    document.getElementById('recordOutcome')?.addEventListener('click', recordOutcomeFlow);
    document.getElementById('proceedOnboarding')?.addEventListener('click', () => {
      if (store.candidate?.interviewOutcome?.outcome !== 'PASS') return;
      pushHistory({ ts: new Date().toISOString(), actor: 'DM', type: 'PROCEED_ONBOARDING', outcome: 'INFO', details: { from: 'INTERVIEW' } });
      setBanner('success', 'Proceeding to onboarding forms.');
      navigate(4);
    });
    document.getElementById('rescheduleFromOutcome')?.addEventListener('click', () => {
      document.getElementById('scheduleCard')?.scrollIntoView({ behavior: 'smooth' });
    });
    document.getElementById('restartInterview')?.addEventListener('click', () => {
      ensureInterviewState();
      store.candidate.interview.status = INTERVIEW_STATUS.NOT_SCHEDULED;
      store.candidate.interview.lastUpdatedAt = new Date().toISOString();
      store.candidate.interviewOutcome = { outcome: null, reasonCode: null, reasonText: null, notes: '', receivedAt: null };
      pushHistory({ ts: new Date().toISOString(), actor: 'DM', type: 'INTERVIEW_RESTARTED', outcome: 'INFO', details: {} });
      render();
    });
    document.getElementById('footerToSchedule')?.addEventListener('click', () => {
      document.getElementById('scheduleCard')?.scrollIntoView({ behavior: 'smooth' });
    });
    document.getElementById('footerPrimary')?.addEventListener('click', () => {
      if (store.candidate?.interviewOutcome?.outcome === 'PASS') {
        pushHistory({ ts: new Date().toISOString(), actor: 'DM', type: 'PROCEED_ONBOARDING', outcome: 'INFO', details: { from: 'INTERVIEW' } });
        setBanner('success', 'Proceeding to onboarding forms.');
        navigate(4);
      } else {
        document.getElementById('recordOutcome')?.scrollIntoView({ behavior: 'smooth' });
      }
    });
  }
  if (store.ui.screen === 4) {
    ensureOnboardingState();
    const ob = store.candidate.onboarding;
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
  }
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
    updateIntegration('INTERVIEW_TASK', { status: STATUS.FAILED, failureType: res.failureType, message: res.message, payload: res });
    if (res.failureType === 'SYSTEM' && (taskExisting.attemptCount||0) < 3) {
      scheduleRetry('INTERVIEW_TASK', taskExisting.attemptCount||0, () => handleSchedule());
    }
    render();
    return;
  }
  ensureInterviewState();
  store.candidate.interview = { ...store.candidate.interview, mode, date, slot, notes, status: INTERVIEW_STATUS.SCHEDULED, lastUpdatedAt: new Date().toISOString() };
  updateIntegration('INTERVIEW_TASK', { status: STATUS.SUCCESS, message: 'Interview scheduled', payload: res, nextRetryAt: null });
  pushHistory({ ts: new Date().toISOString(), actor: 'DM', type: 'INTERVIEW_SCHEDULED', outcome: 'SUCCESS', details: res });
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
  const reason = document.getElementById('bhReason').value;
  const notes = document.getElementById('bhNotes').value;
  if (!outcomeVal) { alert('Select an outcome'); return; }
  const reasonText = reason ? document.querySelector('#bhReason option:checked')?.textContent : '';
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
  const perm = contact.permanentAddress.sameAsCurrent ? contact.currentAddress : contact.permanentAddress;
  ['line1','line2','city','state','pincode'].forEach(k => req('permanentAddress', k, `Permanent ${k}`, perm[k]));
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
  const perm = contact.permanentAddress.sameAsCurrent ? contact.currentAddress : contact.permanentAddress;
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

async function handlePrefill(source) {
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
    statusObj.status = STATUS.FAILED;
    statusObj.message = res.message;
    ob.history.push({ ts: new Date().toISOString(), actor: 'DM', type: `${source.toUpperCase()}_PREFILL_FAIL`, outcome: 'FAIL', details: res });
    pushHistory({ ts: new Date().toISOString(), actor: 'DM', type: `${source.toUpperCase()}_PREFILL_FAIL`, outcome: 'FAIL', details: res });
    render();
    return;
  }
  statusObj.status = STATUS.SUCCESS;
  statusObj.message = `${res.autoFilled} fields auto-filled`;
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
    ob.shareStatus.message = res.message;
    ob.history.push({ ts: new Date().toISOString(), actor: 'DM', type: 'ONBOARDING_SHARE_FAIL', outcome: 'FAIL', details: res });
    pushHistory({ ts: new Date().toISOString(), actor: 'DM', type: 'ONBOARDING_SHARE_FAIL', outcome: 'FAIL', details: res });
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

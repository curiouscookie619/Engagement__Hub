import { store, updateIntegration, pushHistory } from './store.js';
import { STATUS } from './constants.js';
import { nextRetryTime } from './helpers.js';

export const MOCK_FLAGS = {
  NSDL_FAIL: false,
  IRDAI_FAIL: false,
  CKYC_PARTIAL: true,
  CKYC_FAIL: false,
  DL_FAIL: false,
  NAT_DELIVERY_FAIL: false,
  NAT_COMPLETED: true,
  BH_MAP_FAIL: false,
  INTERVIEW_CREATE_FAIL: false,
  NOTIFY_BH_FAIL: false,
  INTERVIEW_SCHEDULE_FAIL: false,
  INTERVIEW_STATUS_FAIL: false,
  OUTCOME_RECORD_FAIL: false,
  CKYC_PREFILL_FAIL: false,
  CKYC_PREFILL_PARTIAL: true,
  DIGILOCKER_PREFILL_FAIL: false,
  DIGILOCKER_PREFILL_PARTIAL: true,
  ONBOARDING_SHARE_FAIL: false,
  OUTCOME_RESULT_FAIL: false
};

export function loadFlagsFromQuery() {
  const params = new URLSearchParams(window.location.search);
  Object.keys(MOCK_FLAGS).forEach(key => {
    if (params.has(key.toLowerCase())) {
      MOCK_FLAGS[key] = params.get(key.toLowerCase()) === 'true';
    }
  });
}

export async function createCandidate({ mobile, pan, email }) {
  await delay();
  if (Math.random() < 0.05) throw new Error('Shell creation failed');
  return {
    id: 'CND12345',
    code: 'CND-000123',
    mobile,
    pan,
    email,
    name: null,
    currentState: 'Verifying identity',
    waitingOn: 'SYSTEM',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    interview: {
      mode: 'TELEPHONIC',
      date: null,
      slot: null,
      notes: '',
      status: 'NOT_SCHEDULED',
      lastUpdatedAt: null
    },
    interviewOutcome: {
      outcome: null,
      reasonCode: null,
      reasonText: null,
      notes: '',
      receivedAt: null
    },
    onboarding: {
      status: 'NOT_STARTED',
      sectionsCompletion: {
        personal: 0,
        education: 0,
        contact: 0,
        bank: 0,
        nominee: 0
      },
      fields: {
        personal: {
          title: '',
          firstName: '',
          middleName: '',
          lastName: '',
          dob: '',
          gender: '',
          maritalStatus: '',
          category: '',
          relationTitle: '',
          relationName: ''
        },
        education: {
          qualification: '',
          institution: '',
          rollNumber: '',
          passingYear: ''
        },
        contact: {
          mobile,
          email,
          currentAddress: { line1: '', line2: '', city: '', state: '', pincode: '' },
          permanentAddress: { line1: '', line2: '', city: '', state: '', pincode: '', sameAsCurrent: false }
        },
        bank: {
          accountNumber: '',
          ifsc: '',
          bankName: '',
          branch: ''
        },
        nominee: {
          name: '',
          relationship: '',
          dob: '',
          declarationAccepted: false
        }
      },
      docs: {
        ckyc: [],
        digilocker: [],
        missing: [],
        manual: {}
      },
      fetchStatus: {
        ckyc: { status: STATUS.NOT_STARTED, lastAttemptAt: null, attemptCount: 0, message: '' },
        digilocker: { status: STATUS.NOT_STARTED, lastAttemptAt: null, attemptCount: 0, message: '' }
      },
      shareStatus: { status: STATUS.NOT_STARTED, lastSharedAt: null, channel: null, attempts: 0, message: '' },
      history: []
    }
  };
}

export async function startOrchestration(candidateId) {
  await delay(300);
  return { started: true, candidateId };
}

function baseResponse(fn) {
  return new Promise((resolve) => setTimeout(() => resolve(fn()), 600 + Math.random()*400));
}

export async function runNsdl(pan) {
  return baseResponse(() => {
    if (MOCK_FLAGS.NSDL_FAIL) {
      return { failureType: 'SYSTEM', message: 'PAN service timeout' };
    }
    return { pan, panValid: true, nameOnPan: 'RAHUL KUMAR', dob: '1994-05-12' };
  });
}

export async function runIrdai(pan) {
  return baseResponse(() => {
    if (MOCK_FLAGS.IRDAI_FAIL) {
      return { failureType: 'DATA', message: 'Not eligible with IRDAI' };
    }
    return { eligible: true, flags: { otherInsurerAssociation: false, blacklisted: false }, remarks: 'Clear' };
  });
}

export async function runCkyc({ pan, mobile }) {
  return baseResponse(() => {
    if (MOCK_FLAGS.CKYC_FAIL) {
      return { failureType: 'SYSTEM', message: 'CKYC gateway down' };
    }
    const partial = MOCK_FLAGS.CKYC_PARTIAL;
    return {
      ckycFound: true,
      profile: { fullName: 'Rahul Kumar', gender: 'M', dob: '1994-05-12' },
      address: { line1: '123 Street', city: 'Mumbai', state: 'MH', pincode: '400001' },
      documents: [
        { type: 'PHOTO', source: 'CKYC', available: true },
        { type: 'AADHAAR', source: 'CKYC', available: partial ? false : true },
        { type: 'ADDRESS_PROOF', source: 'CKYC', available: true }
      ]
    };
  });
}

export async function runDigiLocker({ mobile }) {
  return baseResponse(() => {
    if (MOCK_FLAGS.DL_FAIL) {
      return { failureType: 'SYSTEM', message: 'DL integration down' };
    }
    return { available: true, documents: [{ type: 'EDUCATION_PROOF', source: 'DIGILOCKER', available: true }] };
  });
}

export async function shareNat({ candidateId }) {
  return baseResponse(() => {
    if (MOCK_FLAGS.NAT_DELIVERY_FAIL) {
      return { delivered: false, failureType: 'SYSTEM', message: 'SMS provider unavailable' };
    }
    return { delivered: true };
  });
}

export async function getNatStatus({ candidateId }) {
  return baseResponse(() => {
    return { delivered: true, completed: MOCK_FLAGS.NAT_COMPLETED, score: 50 };
  });
}

export async function resolveBh({ dmId }) {
  return baseResponse(() => {
    if (MOCK_FLAGS.BH_MAP_FAIL) {
      return { failureType: 'SYSTEM', message: 'Mapping failed' };
    }
    return { bhId: 'BH001', bhName: 'Branch Head Name', branch: 'Mumbai - Andheri' };
  });
}

export async function createInterviewTask({ candidateId, bhId, interviewDate, notes }) {
  return baseResponse(() => {
    if (MOCK_FLAGS.INTERVIEW_CREATE_FAIL) {
      return { failureType: 'SYSTEM', message: 'Task service unavailable' };
    }
    return { taskId: randomId('task'), status: 'CREATED', interviewDate, notes };
  });
}

export async function notifyBh({ bhId, candidateId }) {
  return baseResponse(() => {
    if (MOCK_FLAGS.NOTIFY_BH_FAIL) {
      return { failureType: 'SYSTEM', message: 'Notification channel down' };
    }
    return { notified: true };
  });
}

export async function scheduleInterview({ candidateId, mode, date, slot, notes }) {
  return baseResponse(() => {
    if (MOCK_FLAGS.INTERVIEW_SCHEDULE_FAIL) {
      return { failureType: 'SYSTEM', message: 'Scheduling service unavailable' };
    }
    return { interviewId: randomId('int'), scheduledFor: date, slot, mode, notes, status: 'SCHEDULED' };
  });
}

export async function markInterviewStatus({ candidateId, status }) {
  return baseResponse(() => {
    if (MOCK_FLAGS.INTERVIEW_STATUS_FAIL) {
      return { failureType: 'SYSTEM', message: 'Could not update interview status' };
    }
    return { status, updatedAt: new Date().toISOString() };
  });
}

export async function recordInterviewOutcome({ candidateId, outcome, reasonCode, reasonText, notes }) {
  return baseResponse(() => {
    if (MOCK_FLAGS.OUTCOME_RECORD_FAIL) {
      return { failureType: 'SYSTEM', message: 'Outcome service error' };
    }
    const forcedOutcome = MOCK_FLAGS.OUTCOME_RESULT_FAIL ? 'FAIL' : outcome;
    return { outcome: forcedOutcome, reasonCode, reasonText, notes, receivedAt: new Date().toISOString() };
  });
}

export async function fetchCkycPrefill({ pan, mobile }) {
  return baseResponse(() => {
    if (MOCK_FLAGS.CKYC_PREFILL_FAIL) {
      return { failureType: 'SYSTEM', message: 'CKYC fetch failed' };
    }
    const partial = MOCK_FLAGS.CKYC_PREFILL_PARTIAL;
    return {
      autoFilled: partial ? 6 : 10,
      pendingMandatory: partial ? 6 : 2,
      docs: [
        { type: 'PHOTO', source: 'CKYC', available: true },
        { type: 'AADHAAR', source: 'CKYC', available: !partial },
        { type: 'ADDRESS_PROOF', source: 'CKYC', available: true }
      ],
      personal: {
        title: 'Mr.',
        firstName: 'Rahul',
        lastName: 'Kumar',
        dob: '1994-05-12',
        gender: 'Male',
        maritalStatus: 'Single',
        category: 'General',
        relationTitle: 'Mr.',
        relationName: 'Ramesh Kumar'
      },
      address: {
        line1: '123 Street',
        line2: 'Andheri East',
        city: 'Mumbai',
        state: 'MH',
        pincode: '400001'
      }
    };
  });
}

export async function fetchDigiLockerPrefill({ mobile }) {
  return baseResponse(() => {
    if (MOCK_FLAGS.DIGILOCKER_PREFILL_FAIL) {
      return { failureType: 'SYSTEM', message: 'DigiLocker fetch failed' };
    }
    const partial = MOCK_FLAGS.DIGILOCKER_PREFILL_PARTIAL;
    return {
      autoFilled: partial ? 3 : 6,
      pendingMandatory: partial ? 5 : 2,
      docs: [
        { type: 'EDUCATION_PROOF', source: 'DIGILOCKER', available: true, link: '#' },
        { type: 'BANK_PROOF', source: 'DIGILOCKER', available: !partial, link: '#' }
      ],
      education: {
        qualification: 'Graduate',
        institution: 'Mumbai University',
        rollNumber: 'MU12345',
        passingYear: '2015'
      },
      bank: partial ? { accountNumber: '', ifsc: '' } : { accountNumber: '1234567890', ifsc: 'HDFC0001234' }
    };
  });
}

export async function shareOnboardingForm({ candidateId, channel }) {
  return baseResponse(() => {
    if (MOCK_FLAGS.ONBOARDING_SHARE_FAIL) {
      return { failureType: 'SYSTEM', message: 'Share failed, please retry' };
    }
    return { shared: true, channel, sharedAt: new Date().toISOString() };
  });
}

function delay(ms = 500) {
  return new Promise((res) => setTimeout(res, ms));
}

// Auto-retry helper
export function scheduleRetry(key, attempt, fn) {
  const next = nextRetryTime(attempt);
  updateIntegration(key, { nextRetryAt: next });
  if (!next) return;
  setTimeout(async () => {
    await fn();
  }, (new Date(next).getTime() - Date.now()));
}

// Debug panel
export function renderDebugFlags() {
  const rows = Object.keys(MOCK_FLAGS).map(key => `
    <div>${key}</div>
    <div><input type="checkbox" data-flag="${key}" ${MOCK_FLAGS[key] ? 'checked' : ''} /></div>
  `).join('');
  return `<div class="card sim-card">
    <div class="card-header"><div class="card-title">Simulation controls</div><button class="btn btn-text" id="toggleSim">Show</button></div>
    <div class="table-ish sim-body" style="display:none;">${rows}</div>
  </div>`;
}

// random id fallback
function randomId(prefix='id') { return `${prefix}-${Math.random().toString(36).slice(2,8)}`; }

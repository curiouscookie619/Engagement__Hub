import { STATUS, INTERVIEW_STATUS, ONBOARDING_STATUS } from './constants.js';

export const store = {
  dm: {
    id: "DM001",
    name: "DM User",
    branchId: "BR001"
  },
  candidate: null,
  integrations: {
    NSDL: null,
    IRDAI: null,
    CKYC: null,
    DIGILOCKER: null,
    NAT_DELIVERY: null,
    BH_MAP: null,
    INTERVIEW_TASK: null,
    BH_NOTIFY: null,
  },
  readiness: {
    nat: { lastSharedAt: null, delivered: null, completed: null, score: null },
    p50: { leadCount: null, upload: null, completed: false },
    incomePlan: {
      earnAmount: null,
      earnPeriod: "MONTHLY",
      ats: null,
      conversionPct: null,
      derived: null,
      pdf: { generatedAt: null, urlMock: null }
    }
  },
  onboarding: {},
  history: [],
  ui: {
    screen: 0,
    loading: false,
    banner: null,
    shareSheet: false,
    onboardingErrors: {},
    onboardingSummary: false,
    autoPrefillDone: false
  }
};

export function ensureInterviewState() {
  if (!store.candidate) return;
  store.candidate.interview = store.candidate.interview || {
    mode: 'TELEPHONIC',
    date: null,
    slot: null,
    notes: '',
    status: INTERVIEW_STATUS.NOT_SCHEDULED,
    lastUpdatedAt: null
  };
  store.candidate.interviewOutcome = store.candidate.interviewOutcome || {
    outcome: null,
    reasonCode: null,
    reasonText: null,
    notes: '',
    receivedAt: null
  };
}

export function ensureOnboardingState() {
  if (!store.candidate) return;
  store.candidate.onboarding = store.candidate.onboarding || {
    status: ONBOARDING_STATUS.NOT_STARTED,
    sectionsCompletion: {
      personal: 0,
      education: 0,
      contact: 0,
      bank: 0,
      nominee: 0,
      experience: 0,
      exam: 0
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
        mobile: '',
        email: '',
        currentAddress: {
          line1: '',
          line2: '',
          city: '',
          state: '',
          pincode: ''
        },
        permanentAddress: {
          line1: '',
          line2: '',
          city: '',
          state: '',
          pincode: '',
          sameAsCurrent: false
        }
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
      },
      experience: {
        years: '',
        lastOrganization: '',
        lastRole: ''
      },
      exam: {
        preferredCity: '',
        preferredSlot: '',
        language: ''
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
  };
  store.candidate.onboarding.sectionsCompletion = {
    personal: 0,
    education: 0,
    contact: 0,
    bank: 0,
    nominee: 0,
    experience: 0,
    exam: 0,
    ...store.candidate.onboarding.sectionsCompletion
  };
  store.candidate.onboarding.fields.experience = store.candidate.onboarding.fields.experience || { years: '', lastOrganization: '', lastRole: '' };
  store.candidate.onboarding.fields.exam = store.candidate.onboarding.fields.exam || { preferredCity: '', preferredSlot: '', language: '' };
  store.candidate.onboarding.docs.manual = store.candidate.onboarding.docs.manual || {};
  if (!store.candidate.onboarding.fields.contact.mobile && store.candidate.mobile) {
    store.candidate.onboarding.fields.contact.mobile = store.candidate.mobile;
  }
  if (!store.candidate.onboarding.fields.contact.email && store.candidate.email) {
    store.candidate.onboarding.fields.contact.email = store.candidate.email;
  }
}

export function initIntegration(key) {
  return {
    key,
    status: STATUS.PENDING,
    failureType: null,
    message: "",
    lastAttemptAt: new Date().toISOString(),
    nextRetryAt: null,
    attemptCount: 0,
    payload: {}
  };
}

export function pushHistory(event) {
  store.history.push(event);
  persistStore();
}

export function setScreen(n) {
  store.ui.screen = n;
  persistStore();
}

export function setBanner(type, message) {
  store.ui.banner = type ? { type, message } : null;
}

export function updateIntegration(key, data) {
  store.integrations[key] = {
    ...(store.integrations[key] || { key }),
    ...data,
  };
  persistStore();
}

export function resetStore() {
  store.candidate = null;
  store.integrations = {
    NSDL: null,
    IRDAI: null,
    CKYC: null,
    DIGILOCKER: null,
    NAT_DELIVERY: null,
    BH_MAP: null,
    INTERVIEW_TASK: null,
    BH_NOTIFY: null,
  };
  store.readiness = {
    nat: { lastSharedAt: null, delivered: null, completed: null, score: null },
    p50: { leadCount: null, upload: null, completed: false },
    incomePlan: {
      earnAmount: null,
      earnPeriod: "MONTHLY",
      ats: null,
      conversionPct: null,
      derived: null,
      pdf: { generatedAt: null, urlMock: null }
    }
  };
  store.history = [];
  store.ui.banner = null;
  store.ui.screen = 0;
  store.ui.autoPrefillDone = false;
  persistStore();
}

const STORAGE_KEY = 'pfa_onboarding_store';

function persistStore() {
  try {
    if (typeof localStorage === 'undefined') return;
    const snapshot = {
      dm: store.dm,
      candidate: store.candidate,
      integrations: store.integrations,
      readiness: store.readiness,
      history: store.history,
      ui: store.ui
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch (e) {
    // ignore storage errors
  }
}

export function loadStore() {
  try {
    if (typeof localStorage === 'undefined') return;
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return;
    const parsed = JSON.parse(data);
    Object.assign(store, parsed);
  } catch (e) {
    // ignore parse errors
  }
}

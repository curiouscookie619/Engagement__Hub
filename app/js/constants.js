export const RETRY_DELAYS = [30, 120, 600];
export const STATUS = {
  NOT_STARTED: "NOT_STARTED",
  PENDING: "PENDING",
  SUCCESS: "SUCCESS",
  FAILED: "FAILED",
  PARTIAL: "PARTIAL"
};

export const PERIODS = ["MONTHLY", "QUARTERLY", "ANNUAL"];
export const COMMISSION_RATE = 0.25;
export const CONVERSATIONS_PER_BUYER = 3;
export const MINUTES_PER_CONVERSATION = 10;
export const DAYS_PER_WEEK = 6;
export const INTERVIEW_STATUS = {
  NOT_SCHEDULED: 'NOT_SCHEDULED',
  SCHEDULED: 'SCHEDULED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
};
export const ONBOARDING_STATUS = {
  NOT_STARTED: 'NOT_STARTED',
  IN_PROGRESS: 'IN_PROGRESS',
  SHARED_FOR_REVIEW: 'SHARED_FOR_REVIEW'
};

export const HELP_MAP = {
  lead: {
    NAT_EMAIL_MISSING: {
      userMessage: 'NAT needs both SMS and email to deliver the link.',
      whyRetry: 'Once email is added, delivery usually succeeds on the next attempt.',
      retryScheduleText: 'Retry immediately after adding email.',
      tips: [
        'Capture the candidate email before sending NAT.',
        'Verify the mobile number has no typos.',
        'If SMS fails repeatedly, try resending after a minute.'
      ]
    }
  },
  profile: {
    NSDL_FAIL: {
      userMessage: 'PAN verification failed.',
      whyRetry: 'PAN gateway can be intermittent; a retry often works.',
      retryScheduleText: 'Auto-retry in the next scheduled window.',
      tips: [
        'Double-check PAN entry.',
        'Retry now if the candidate is available.',
        'If it keeps failing, raise a support ticket with PAN and timestamp.'
      ]
    },
    IRDAI_FAIL: {
      userMessage: 'IRDAI eligibility did not complete.',
      whyRetry: 'Network issues can block the check temporarily.',
      retryScheduleText: 'Auto-retry will trigger based on the retry policy.',
      tips: [
        'Confirm PAN is correct.',
        'Retry once now; if still failing, wait for auto-retry.',
        'Escalate with PAN and candidate code if it persists.'
      ]
    },
    CKYC_FAIL: {
      userMessage: 'CKYC lookup failed.',
      whyRetry: 'CKYC service may be temporarily unavailable.',
      retryScheduleText: 'We will retry automatically; you can also retry now.',
      tips: [
        'Ensure PAN and mobile are correct.',
        'Retry after a short wait.',
        'If CKYC is unavailable, proceed when retried successfully.'
      ]
    },
    DIGILOCKER_FAIL: {
      userMessage: 'DigiLocker fetch failed.',
      whyRetry: 'Doc gateway sometimes times out; retry often helps.',
      retryScheduleText: 'Auto-retry follows the standard schedule.',
      tips: [
        'Confirm mobile is correct.',
        'Retry now or wait for auto-retry.',
        'If docs stay unavailable, proceed with manual checks later.'
      ]
    }
  },
  readiness: {
    NAT_DELIVERY_FAIL: {
      userMessage: 'NAT link could not be delivered.',
      whyRetry: 'SMS/email providers can be intermittent.',
      retryScheduleText: 'Auto-retry will be attempted; you can resend after fixing contact info.',
      tips: [
        'Ensure email is present and correct.',
        'Confirm mobile number has 10 digits.',
        'Retry once now; if it fails again, wait before another attempt.'
      ]
    }
  },
  interview: {
    INTERVIEW_SCHEDULE_FAIL: {
      userMessage: 'Interview scheduling request did not go through.',
      whyRetry: 'Network or BH mapping issues can cause temporary failures.',
      retryScheduleText: 'We will retry per policy if it was a system error.',
      tips: [
        'Retry now.',
        'Confirm BH mapping is available.',
        'If it persists, raise a ticket with candidate code and BH details.'
      ]
    }
  },
  onboarding: {
    ONBOARDING_SHARE_FAIL: {
      userMessage: 'Sharing the form failed.',
      whyRetry: 'Channel providers may be slow; a retry usually works.',
      retryScheduleText: 'Auto-retry applies for system issues.',
      tips: [
        'Retry with another channel.',
        'Confirm candidate contact details are correct.',
        'If it keeps failing, raise a ticket with candidate code and channel used.'
      ]
    }
  }
};

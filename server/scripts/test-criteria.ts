/**
 * Criteria Validation Test Script
 *
 * Tests all edge cases for the unified criteria matching system.
 * Run with: npx tsx server/scripts/test-criteria.ts
 */

import {
  matchEmail,
  loadUnifiedCriteria,
  saveUnifiedCriteria,
  type UnifiedCriteria,
  type Action
} from '../services/criteria.js';
import type { EmailData } from '../types/index.js';

// ============================================================================
// TEST UTILITIES
// ============================================================================

interface TestCase {
  name: string;
  description: string;
  email: Partial<EmailData>;
  expectedAction: Action | null;
  expectedReason?: string;
}

interface TestGroup {
  name: string;
  setup?: UnifiedCriteria;  // Criteria to use for this group
  tests: TestCase[];
}

let passed = 0;
let failed = 0;
const failures: string[] = [];

function createEmail(overrides: Partial<EmailData>): EmailData {
  return {
    id: 'test-' + Math.random().toString(36).slice(2),
    from: overrides.from || 'sender@example.com',
    email: overrides.email || 'sender@example.com',
    subject: overrides.subject || 'Test Subject',
    date: overrides.date || new Date().toISOString(),
    category: overrides.category || 'UNKNOWN',
    categoryIcon: '🔵',
    categoryColor: '#0d6efd',
    categoryBg: '#cfe2ff',
    primaryDomain: overrides.primaryDomain || 'example.com',
    subdomain: overrides.subdomain || 'example.com',
    toEmails: overrides.toEmails || '',
    ccEmails: overrides.ccEmails || '',
    matchedKeyword: null,
  };
}

function runTest(test: TestCase): boolean {
  const email = createEmail(test.email);
  const result = matchEmail(email);

  const actionMatch = result.action === test.expectedAction;
  const reasonMatch = !test.expectedReason || result.reason.includes(test.expectedReason);

  if (actionMatch && reasonMatch) {
    passed++;
    console.log(`  ✓ ${test.name}`);
    return true;
  } else {
    failed++;
    const msg = `  ✗ ${test.name}\n` +
      `    Expected: action=${test.expectedAction}, reason contains "${test.expectedReason || '(any)'}"\n` +
      `    Got:      action=${result.action}, reason="${result.reason}"`;
    console.log(msg);
    failures.push(msg);
    return false;
  }
}

function runTestGroup(group: TestGroup, originalCriteria: UnifiedCriteria): void {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`TEST GROUP: ${group.name}`);
  console.log('='.repeat(60));

  // If group has custom setup, temporarily replace criteria
  if (group.setup) {
    saveUnifiedCriteria(group.setup);
  }

  for (const test of group.tests) {
    runTest(test);
  }

  // Restore original criteria
  if (group.setup) {
    saveUnifiedCriteria(originalCriteria);
  }
}

// ============================================================================
// TEST CRITERIA SETUP
// ============================================================================

const TEST_CRITERIA: UnifiedCriteria = {
  // Case 1: Simple domain with default action
  "simple-delete.com": {
    default: "delete"
  },

  "simple-keep.com": {
    default: "keep"
  },

  "simple-delete1d.com": {
    default: "delete_1d"
  },

  // Case 2: Domain with subject patterns only (no default)
  "patterns-only.com": {
    keep: ["important", "urgent"],
    delete: ["newsletter", "promo"],
    delete_1d: ["otp", "verification"]
  },

  // Case 3: Domain with default + patterns (patterns override default)
  "default-with-overrides.com": {
    default: "delete",
    keep: ["receipt", "statement"],
    delete_1d: ["otp"]
  },

  // Case 4: Domain with excludeSubjects
  "exclude-test.com": {
    default: "delete",
    excludeSubjects: ["order", "receipt", "confirmation"]
  },

  // Case 5: Domain with excludeSubjects + explicit patterns
  "exclude-with-patterns.com": {
    default: "delete",
    excludeSubjects: ["important"],
    delete: ["flash sale"],  // Explicit pattern should still work
    keep: ["account security"]
  },

  // Case 6: Domain with subdomain overrides
  "parent-domain.com": {
    default: "delete",
    keep: ["statement"],
    subdomains: {
      "alerts.parent-domain.com": {
        default: "keep"
      },
      "marketing.parent-domain.com": {
        default: "delete",
        keep: ["survey results"]
      },
      "notifications.parent-domain.com": {
        // No default - patterns only
        keep: ["security alert"],
        delete_1d: ["daily digest"]
      }
    }
  },

  // Case 7: Empty domain entry (undecided)
  "empty-rules.com": {},

  // Case 8: Keep with delete patterns (priority test)
  "priority-test.com": {
    default: "delete",
    keep: ["urgent"],
    delete: ["urgent newsletter"]  // Should this match? keep should win
  },

  // Case 9: Case sensitivity test
  "case-test.com": {
    default: "keep",
    delete: ["Newsletter"]  // Pattern is capitalized
  },

  // Case 10: Partial matching test
  "partial-match.com": {
    default: "keep",
    delete: ["order"]  // Should match "Your order shipped", "Reorder now", etc.
  },

  // Case 11: Real-world .co.in domain
  "testbank.co.in": {
    default: "keep",
    delete: ["webinar", "nominee updation"],
    delete_1d: ["otp", "login alert"],
    subdomains: {
      "alerts.testbank.co.in": {
        default: "keep"
      },
      "promo.testbank.co.in": {
        default: "delete"
      }
    }
  }
};

// ============================================================================
// TEST GROUPS
// ============================================================================

const testGroups: TestGroup[] = [
  // -------------------------------------------------------------------------
  // Group 1: Basic Default Actions
  // -------------------------------------------------------------------------
  {
    name: "1. Basic Default Actions",
    setup: TEST_CRITERIA,
    tests: [
      {
        name: "Domain with default=delete should DELETE",
        description: "Simple domain-level delete",
        email: { primaryDomain: "simple-delete.com", subject: "Any subject" },
        expectedAction: "delete",
        expectedReason: "default action"
      },
      {
        name: "Domain with default=keep should KEEP",
        description: "Simple domain-level keep",
        email: { primaryDomain: "simple-keep.com", subject: "Any subject" },
        expectedAction: "keep",
        expectedReason: "default action"
      },
      {
        name: "Domain with default=delete_1d should DELETE_1D",
        description: "Simple domain-level delete after 1 day",
        email: { primaryDomain: "simple-delete1d.com", subject: "Any subject" },
        expectedAction: "delete_1d",
        expectedReason: "default action"
      },
      {
        name: "Unknown domain should be UNDECIDED (null)",
        description: "Domain not in criteria",
        email: { primaryDomain: "unknown-domain.com", subject: "Any subject" },
        expectedAction: null,
        expectedReason: "not in criteria"
      }
    ]
  },

  // -------------------------------------------------------------------------
  // Group 2: Subject Pattern Matching (No Default)
  // -------------------------------------------------------------------------
  {
    name: "2. Subject Pattern Matching (No Default)",
    setup: TEST_CRITERIA,
    tests: [
      {
        name: "Subject matches keep[] pattern should KEEP",
        description: "Explicit keep pattern without default",
        email: { primaryDomain: "patterns-only.com", subject: "This is important update" },
        expectedAction: "keep",
        expectedReason: "keep pattern"
      },
      {
        name: "Subject matches delete[] pattern should DELETE",
        description: "Explicit delete pattern without default",
        email: { primaryDomain: "patterns-only.com", subject: "Weekly newsletter" },
        expectedAction: "delete",
        expectedReason: "delete pattern"
      },
      {
        name: "Subject matches delete_1d[] pattern should DELETE_1D",
        description: "Explicit delete_1d pattern without default",
        email: { primaryDomain: "patterns-only.com", subject: "Your OTP is 123456" },
        expectedAction: "delete_1d",
        expectedReason: "delete_1d pattern"
      },
      {
        name: "Subject matches nothing should be UNDECIDED",
        description: "No pattern match and no default",
        email: { primaryDomain: "patterns-only.com", subject: "Random email" },
        expectedAction: null,
        expectedReason: "no matching rule"
      }
    ]
  },

  // -------------------------------------------------------------------------
  // Group 3: Pattern Priority (Patterns Override Default)
  // -------------------------------------------------------------------------
  {
    name: "3. Pattern Priority (Patterns Override Default)",
    setup: TEST_CRITERIA,
    tests: [
      {
        name: "Keep pattern should override default=delete",
        description: "keep[] has highest priority",
        email: { primaryDomain: "default-with-overrides.com", subject: "Your monthly statement" },
        expectedAction: "keep",
        expectedReason: "keep pattern"
      },
      {
        name: "Delete_1d pattern should apply when default=delete",
        description: "delete_1d[] overrides default action",
        email: { primaryDomain: "default-with-overrides.com", subject: "Your OTP is 123456" },
        expectedAction: "delete_1d",
        expectedReason: "delete_1d pattern"
      },
      {
        name: "No pattern match should fall back to default",
        description: "Default applies when no patterns match",
        email: { primaryDomain: "default-with-overrides.com", subject: "Random promo email" },
        expectedAction: "delete",
        expectedReason: "default action"
      }
    ]
  },

  // -------------------------------------------------------------------------
  // Group 4: excludeSubjects Behavior (excludeSubjects → KEEP)
  // -------------------------------------------------------------------------
  {
    name: "4. excludeSubjects Behavior",
    setup: TEST_CRITERIA,
    tests: [
      {
        name: "Subject containing excluded term should be KEEP",
        description: "excludeSubjects protects emails (keeps them)",
        email: { primaryDomain: "exclude-test.com", subject: "Your order has shipped" },
        expectedAction: "keep",
        expectedReason: "excludeSubjects"
      },
      {
        name: "Subject containing another excluded term should be KEEP",
        description: "Multiple exclude terms work",
        email: { primaryDomain: "exclude-test.com", subject: "Payment receipt attached" },
        expectedAction: "keep",
        expectedReason: "excludeSubjects"
      },
      {
        name: "Subject not containing excluded term should DELETE",
        description: "Default applies when not excluded",
        email: { primaryDomain: "exclude-test.com", subject: "Flash sale 50% off" },
        expectedAction: "delete",
        expectedReason: "default action"
      }
    ]
  },

  // -------------------------------------------------------------------------
  // Group 5: excludeSubjects with Explicit Patterns
  // -------------------------------------------------------------------------
  {
    name: "5. excludeSubjects + Explicit Patterns",
    setup: TEST_CRITERIA,
    tests: [
      {
        name: "Explicit delete[] pattern should DELETE even if contains excluded term",
        description: "Explicit patterns take priority over excludeSubjects",
        email: { primaryDomain: "exclude-with-patterns.com", subject: "Flash sale important items" },
        expectedAction: "delete",
        expectedReason: "delete pattern"
      },
      {
        name: "Keep pattern should KEEP (highest priority)",
        description: "keep[] always wins",
        email: { primaryDomain: "exclude-with-patterns.com", subject: "Account security alert" },
        expectedAction: "keep",
        expectedReason: "keep pattern"
      },
      {
        name: "Only excluded term (no pattern match) should KEEP",
        description: "excludeSubjects protects emails",
        email: { primaryDomain: "exclude-with-patterns.com", subject: "Important notice" },
        expectedAction: "keep",
        expectedReason: "excludeSubjects"
      }
    ]
  },

  // -------------------------------------------------------------------------
  // Group 6: Subdomain Override Behavior
  // -------------------------------------------------------------------------
  {
    name: "6. Subdomain Override Behavior",
    setup: TEST_CRITERIA,
    tests: [
      {
        name: "Subdomain with default=keep should KEEP",
        description: "Subdomain completely overrides parent",
        email: {
          primaryDomain: "parent-domain.com",
          subdomain: "alerts.parent-domain.com",
          subject: "Any alert"
        },
        expectedAction: "keep",
        expectedReason: "default action"
      },
      {
        name: "Subdomain pattern should work within subdomain rules",
        description: "Subdomain has its own patterns",
        email: {
          primaryDomain: "parent-domain.com",
          subdomain: "marketing.parent-domain.com",
          subject: "Survey results are in"
        },
        expectedAction: "keep",
        expectedReason: "keep pattern"
      },
      {
        name: "Subdomain default should apply when no pattern match",
        description: "Subdomain default applies",
        email: {
          primaryDomain: "parent-domain.com",
          subdomain: "marketing.parent-domain.com",
          subject: "New promo campaign"
        },
        expectedAction: "delete",
        expectedReason: "default action"
      },
      {
        name: "Subdomain with no default should be UNDECIDED if no pattern match",
        description: "Subdomain without default",
        email: {
          primaryDomain: "parent-domain.com",
          subdomain: "notifications.parent-domain.com",
          subject: "Random notification"
        },
        expectedAction: null,
        expectedReason: "no matching rule"
      },
      {
        name: "Subdomain with pattern match should work",
        description: "Subdomain pattern matching",
        email: {
          primaryDomain: "parent-domain.com",
          subdomain: "notifications.parent-domain.com",
          subject: "Security alert for your account"
        },
        expectedAction: "keep",
        expectedReason: "keep pattern"
      },
      {
        name: "Unknown subdomain should fallback to parent domain rules",
        description: "Subdomain not in criteria uses parent",
        email: {
          primaryDomain: "parent-domain.com",
          subdomain: "unknown.parent-domain.com",
          subject: "Random email"
        },
        expectedAction: "delete",
        expectedReason: "default action"
      },
      {
        name: "Unknown subdomain should match parent pattern",
        description: "Parent patterns apply to unknown subdomains",
        email: {
          primaryDomain: "parent-domain.com",
          subdomain: "unknown.parent-domain.com",
          subject: "Your bank statement"
        },
        expectedAction: "keep",
        expectedReason: "keep pattern"
      }
    ]
  },

  // -------------------------------------------------------------------------
  // Group 7: Edge Cases
  // -------------------------------------------------------------------------
  {
    name: "7. Edge Cases",
    setup: TEST_CRITERIA,
    tests: [
      {
        name: "Empty domain rules should be UNDECIDED",
        description: "Domain exists but has no rules",
        email: { primaryDomain: "empty-rules.com", subject: "Any subject" },
        expectedAction: null,
        expectedReason: "no matching rule"
      },
      {
        name: "Empty subject should still match default",
        description: "Empty subject with default action",
        email: { primaryDomain: "simple-delete.com", subject: "" },
        expectedAction: "delete",
        expectedReason: "default action"
      },
      {
        name: "Case insensitive pattern matching",
        description: "Pattern 'Newsletter' should match 'newsletter'",
        email: { primaryDomain: "case-test.com", subject: "weekly newsletter digest" },
        expectedAction: "delete",
        expectedReason: "delete pattern"
      },
      {
        name: "Case insensitive pattern matching (uppercase subject)",
        description: "Pattern 'Newsletter' should match 'NEWSLETTER'",
        email: { primaryDomain: "case-test.com", subject: "WEEKLY NEWSLETTER" },
        expectedAction: "delete",
        expectedReason: "delete pattern"
      },
      {
        name: "Partial/contains matching should work",
        description: "'order' matches 'Your order shipped'",
        email: { primaryDomain: "partial-match.com", subject: "Your order has shipped" },
        expectedAction: "delete",
        expectedReason: "delete pattern"
      },
      {
        name: "Partial matching includes word boundaries",
        description: "'order' also matches 'Reorder now'",
        email: { primaryDomain: "partial-match.com", subject: "Reorder now for 10% off" },
        expectedAction: "delete",
        expectedReason: "delete pattern"
      }
    ]
  },

  // -------------------------------------------------------------------------
  // Group 8: Priority Order Test
  // -------------------------------------------------------------------------
  {
    name: "8. Priority Order (keep > delete > delete_1d)",
    setup: TEST_CRITERIA,
    tests: [
      {
        name: "Keep should win over delete for overlapping patterns",
        description: "Subject matches both keep and delete patterns",
        email: { primaryDomain: "priority-test.com", subject: "Urgent newsletter update" },
        expectedAction: "keep",  // 'urgent' is in keep[], 'newsletter' would be in delete[] if we added it
        expectedReason: "keep pattern"
      }
    ]
  },

  // -------------------------------------------------------------------------
  // Group 9: Real-world .co.in Domain Test
  // -------------------------------------------------------------------------
  {
    name: "9. Real-world .co.in Domain",
    setup: TEST_CRITERIA,
    tests: [
      {
        name: "Bank alert subdomain should KEEP",
        description: "Banking alerts are kept",
        email: {
          primaryDomain: "testbank.co.in",
          subdomain: "alerts.testbank.co.in",
          subject: "Transaction alert"
        },
        expectedAction: "keep",
        expectedReason: "default action"
      },
      {
        name: "Bank promo subdomain should DELETE",
        description: "Promo emails are deleted",
        email: {
          primaryDomain: "testbank.co.in",
          subdomain: "promo.testbank.co.in",
          subject: "Exclusive offer"
        },
        expectedAction: "delete",
        expectedReason: "default action"
      },
      {
        name: "Main bank domain with OTP should DELETE_1D",
        description: "OTP emails wait 1 day",
        email: {
          primaryDomain: "testbank.co.in",
          subdomain: "testbank.co.in",
          subject: "Your OTP is 123456"
        },
        expectedAction: "delete_1d",
        expectedReason: "delete_1d pattern"
      },
      {
        name: "Main bank domain with webinar should DELETE",
        description: "Webinar emails are deleted",
        email: {
          primaryDomain: "testbank.co.in",
          subdomain: "testbank.co.in",
          subject: "Join our webinar on investments"
        },
        expectedAction: "delete",
        expectedReason: "delete pattern"
      },
      {
        name: "Main bank domain with statement should KEEP",
        description: "Regular bank emails are kept",
        email: {
          primaryDomain: "testbank.co.in",
          subdomain: "testbank.co.in",
          subject: "Your monthly statement"
        },
        expectedAction: "keep",
        expectedReason: "default action"
      }
    ]
  }
];

// ============================================================================
// WORKFLOW VISUALIZATION
// ============================================================================

function printWorkflow(): void {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                    EMAIL MATCHING WORKFLOW                                    ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║   ┌─────────────────┐                                                        ║
║   │  Incoming Email │                                                        ║
║   │  from: X@Y.com  │                                                        ║
║   └────────┬────────┘                                                        ║
║            │                                                                 ║
║            ▼                                                                 ║
║   ┌─────────────────┐                                                        ║
║   │ Extract Domains │                                                        ║
║   │ primaryDomain=Y │                                                        ║
║   │ subdomain=X.Y   │                                                        ║
║   └────────┬────────┘                                                        ║
║            │                                                                 ║
║            ▼                                                                 ║
║   ┌─────────────────┐      ┌─────────────────────────────────────┐          ║
║   │ Domain in       │──NO──│ UNDECIDED (null)                    │          ║
║   │ criteria?       │      │ → Shown in dashboard for review     │          ║
║   └────────┬────────┘      └─────────────────────────────────────┘          ║
║            │ YES                                                             ║
║            ▼                                                                 ║
║   ┌─────────────────┐      ┌─────────────────────────────────────┐          ║
║   │ Subdomain has   │──YES─│ Use ONLY subdomain rules            │          ║
║   │ specific rules? │      │ (completely overrides parent)       │──────┐   ║
║   └────────┬────────┘      └─────────────────────────────────────┘      │   ║
║            │ NO                                                          │   ║
║            ▼                                                             │   ║
║   ┌─────────────────┐                                                    │   ║
║   │ Use parent      │◄───────────────────────────────────────────────────┘   ║
║   │ domain rules    │                                                        ║
║   └────────┬────────┘                                                        ║
║            │                                                                 ║
║            ▼                                                                 ║
║   ╔═════════════════════════════════════════════════════════════╗           ║
║   ║           PATTERN MATCHING (in priority order)               ║           ║
║   ╠═════════════════════════════════════════════════════════════╣           ║
║   ║                                                              ║           ║
║   ║   1. Check keep[] patterns                                   ║           ║
║   ║      └─ Subject contains any pattern? → KEEP                 ║           ║
║   ║                                                              ║           ║
║   ║   2. Check delete[] patterns                                 ║           ║
║   ║      └─ Subject contains any pattern? → DELETE               ║           ║
║   ║                                                              ║           ║
║   ║   3. Check delete_1d[] patterns                              ║           ║
║   ║      └─ Subject contains any pattern? → DELETE_1D            ║           ║
║   ║                                                              ║           ║
║   ║   4. Check default action                                    ║           ║
║   ║      └─ Has default?                                         ║           ║
║   ║          └─ YES: Check excludeSubjects[]                     ║           ║
║   ║              └─ Subject contains excluded term?              ║           ║
║   ║                  └─ YES: UNDECIDED (null)                    ║           ║
║   ║                  └─ NO:  Apply default action                ║           ║
║   ║          └─ NO:  UNDECIDED (null)                            ║           ║
║   ║                                                              ║           ║
║   ╚═════════════════════════════════════════════════════════════╝           ║
║                                                                              ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                         ACTION OUTCOMES                                       ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║   ┌──────────────┬────────────────────────────────────────────────────────┐ ║
║   │ Action       │ What Happens                                           │ ║
║   ├──────────────┼────────────────────────────────────────────────────────┤ ║
║   │ KEEP         │ Email is protected, never deleted                      │ ║
║   │ DELETE       │ Email is deleted immediately when execute runs         │ ║
║   │ DELETE_1D    │ Email is deleted only if >1 day old (protects OTPs)    │ ║
║   │ UNDECIDED    │ Email appears in dashboard for manual review           │ ║
║   └──────────────┴────────────────────────────────────────────────────────┘ ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);
}

// ============================================================================
// MAIN TEST RUNNER
// ============================================================================

async function main() {
  console.log('\n' + '█'.repeat(70));
  console.log('  UNIFIED CRITERIA VALIDATION TEST SUITE');
  console.log('█'.repeat(70));

  // Print workflow first
  printWorkflow();

  // Backup original criteria
  const originalCriteria = loadUnifiedCriteria();

  console.log('\nRunning test groups...\n');

  try {
    for (const group of testGroups) {
      runTestGroup(group, originalCriteria);
    }
  } finally {
    // Always restore original criteria
    saveUnifiedCriteria(originalCriteria);
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`  Total:  ${passed + failed}`);
  console.log(`  Passed: ${passed} ✓`);
  console.log(`  Failed: ${failed} ✗`);

  if (failures.length > 0) {
    console.log('\nFailed Tests:');
    failures.forEach(f => console.log(f));
  }

  console.log('\n');

  // Exit with appropriate code
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});

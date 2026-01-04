/**
 * Email Classification Service
 *
 * Keyword-based rules for classifying emails by subject.
 * Categories help identify which emails are safe to delete vs. important to keep.
 */

import type { CategoryInfo, ClassificationResult } from '../types/index.js';

// Category definitions with colors and keywords
export const CATEGORIES: Record<string, CategoryInfo> = {
  PROMO: {
    color: '#28a745',  // green - safe to delete
    bgColor: '#d4edda',
    icon: '🟢',
    description: 'Promotional - likely safe to delete',
    keywords: [
      'sale', '% off', 'deal', 'save', 'free', 'offer', 'discount',
      'webinar', 'newsletter', 'digest', 'trending', 'recommended',
      'treating you to', 'qualify for', 'Fitbit', 'smart scale',
      'limited time', 'expires', "don't miss", 'last chance',
      'exclusive', 'special offer', 'promo', 'coupon', 'savings',
      'clearance', 'flash sale', 'black friday', 'cyber monday',
      'holiday sale', 'end of season', 'reward', 'bonus', 'gift card',
      'earn points', 'member benefit', 'upgrade now', 'try free',
      'get started', 'join now', 'sign up today', 'act now',
      'hurry', 'today only', 'this week only', 'while supplies last'
    ]
  },
  NEWSLETTER: {
    color: '#17a2b8',  // teal - usually safe to delete
    bgColor: '#d1ecf1',
    icon: '📰',
    description: 'Newsletter - usually safe to delete',
    keywords: [
      'newsletter', 'weekly update', 'daily digest', 'monthly roundup',
      'week in review', 'news at', "what's new", 'latest from',
      'insights', 'tips and tricks', 'blog post', 'new article',
      'market outlook', 'industry news', 'tech news'
    ]
  },
  ALERT: {
    color: '#dc3545',  // red - keep
    bgColor: '#f8d7da',
    icon: '🔴',
    description: 'Alert - important, keep',
    keywords: [
      'alert', 'transaction', 'payment received', 'payment made',
      'payment scheduled', 'payment drafted', 'payment confirmed',
      'account activity', 'unusual activity', 'fraud', 'suspicious'
    ]
  },
  RECEIPT: {
    color: '#dc3545',  // red - keep
    bgColor: '#f8d7da',
    icon: '🧾',
    description: 'Receipt - keep for records',
    keywords: [
      'receipt', 'invoice', 'your order', 'order confirmed',
      'order number', 'purchase', 'payment confirmation',
      'billing', 'charged', 'subscription confirmed'
    ]
  },
  STATEMENT: {
    color: '#dc3545',  // red - keep
    bgColor: '#f8d7da',
    icon: '📄',
    description: 'Statement - important financial document',
    keywords: [
      'statement', 'account update', 'form 16', 'tds', 'gst',
      'tax certificate', 'annual report', 'quarterly report',
      'account summary', 'balance', 'eStatement', 'e-statement',
      'combined statement', 'monthly statement'
    ]
  },
  SECURITY: {
    color: '#dc3545',  // red - keep
    bgColor: '#f8d7da',
    icon: '🔒',
    description: 'Security - important, keep',
    keywords: [
      'security alert', 'verification', 'otp', 'sign in',
      'new login', 'password', 'authentication', 'verify your',
      'confirm your identity', 'two-factor', '2fa', 'access code',
      'security code', 'one-time', 'suspicious sign-in'
    ]
  },
  MEDICAL: {
    color: '#dc3545',  // red - keep
    bgColor: '#f8d7da',
    icon: '🏥',
    description: 'Medical - important health info',
    keywords: [
      'mychart', 'appointment', 'doctor', 'prescription',
      'health', 'medical', 'patient', 'clinic', 'hospital',
      'lab results', 'test results', 'diagnosis', 'treatment',
      'pharmacy', 'medication', 'vaccine', 'immunization',
      'explanation of benefits', 'eob', 'claim', 'insurance claim'
    ]
  },
  ORDER: {
    color: '#dc3545',  // red - keep
    bgColor: '#f8d7da',
    icon: '📦',
    description: 'Order/Shipping - keep for tracking',
    keywords: [
      'shipped', 'delivered', 'tracking', 'out for delivery',
      'in transit', 'delivery scheduled', 'package', 'shipment',
      'carrier', 'fedex', 'ups', 'usps', 'dhl', 'on its way',
      'expected delivery', 'order status', 'dispatch'
    ]
  },
  TRAVEL: {
    color: '#dc3545',  // red - keep
    bgColor: '#f8d7da',
    icon: '✈️',
    description: 'Travel - keep booking info',
    keywords: [
      'flight', 'boarding', 'itinerary', 'booking confirmation',
      'reservation', 'check-in', 'baggage', 'gate', 'departure',
      'arrival', 'hotel', 'car rental', 'trip', 'travel'
    ]
  },
  MORTGAGE: {
    color: '#dc3545',  // red - keep
    bgColor: '#f8d7da',
    icon: '🏠',
    description: 'Mortgage/Property - important financial',
    keywords: [
      'mortgage', 'escrow', 'property tax', 'home loan',
      'interest rate', 'loan payment', 'refinance', 'deed',
      'title', 'homeowner', 'hoa'
    ]
  },
  UNKNOWN: {
    color: '#ffc107',  // yellow - review
    bgColor: '#fff3cd',
    icon: '🟡',
    description: 'Unknown - needs manual review',
    keywords: []  // fallback - no keywords, catches everything else
  }
};

// Priority order for classification (first match wins)
const CATEGORY_PRIORITY = [
  'SECURITY',    // Security first - most critical
  'ALERT',       // Transaction alerts
  'MEDICAL',     // Health info
  'TRAVEL',      // Travel bookings
  'MORTGAGE',    // Property/mortgage
  'ORDER',       // Shipping/delivery
  'RECEIPT',     // Purchase receipts
  'STATEMENT',   // Financial statements
  'NEWSLETTER',  // Newsletters
  'PROMO',       // Promotional
  'UNKNOWN'      // Fallback
];

/**
 * Classify an email based on its subject line.
 */
export function classifyEmail(subject: string): ClassificationResult {
  if (!subject) {
    return {
      category: 'UNKNOWN',
      color: CATEGORIES.UNKNOWN.color,
      bgColor: CATEGORIES.UNKNOWN.bgColor,
      icon: CATEGORIES.UNKNOWN.icon,
      description: CATEGORIES.UNKNOWN.description,
      matchedKeyword: null
    };
  }

  const subjectLower = subject.toLowerCase();

  // Check categories in priority order
  for (const catName of CATEGORY_PRIORITY) {
    if (catName === 'UNKNOWN') continue;

    const catInfo = CATEGORIES[catName];
    if (!catInfo) continue;

    for (const keyword of catInfo.keywords) {
      if (subjectLower.includes(keyword.toLowerCase())) {
        return {
          category: catName,
          color: catInfo.color,
          bgColor: catInfo.bgColor,
          icon: catInfo.icon,
          description: catInfo.description,
          matchedKeyword: keyword
        };
      }
    }
  }

  // No match found - return UNKNOWN
  return {
    category: 'UNKNOWN',
    color: CATEGORIES.UNKNOWN.color,
    bgColor: CATEGORIES.UNKNOWN.bgColor,
    icon: CATEGORIES.UNKNOWN.icon,
    description: CATEGORIES.UNKNOWN.description,
    matchedKeyword: null
  };
}

/**
 * Get info for a specific category.
 */
export function getCategoryInfo(categoryName: string): CategoryInfo {
  return CATEGORIES[categoryName] ?? CATEGORIES.UNKNOWN;
}

/**
 * Get all category definitions.
 */
export function getAllCategories(): Record<string, CategoryInfo> {
  return CATEGORIES;
}

/**
 * Check if a category is generally safe to delete.
 */
export function isSafeToDelete(category: string): boolean {
  return category === 'PROMO' || category === 'NEWSLETTER';
}

/**
 * Check if a category is important to keep.
 */
export function isImportant(category: string): boolean {
  return ['SECURITY', 'ALERT', 'MEDICAL', 'TRAVEL', 'MORTGAGE', 'ORDER', 'RECEIPT', 'STATEMENT'].includes(category);
}

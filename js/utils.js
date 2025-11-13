/* =========================================
   NaluXrp 🌊 – Utilities Module
   Shared utility functions for the application
   ========================================= */

/**
 * Format numbers with commas and decimal places
 * @param {number} number - The number to format
 * @param {number} decimals - Number of decimal places (default: 2)
 * @param {boolean} compact - Whether to use compact notation (K, M, B)
 * @returns {string} Formatted number string
 */
function formatNumber(number, decimals = 2, compact = false) {
    if (number === null || number === undefined || isNaN(number)) {
        return '0';
    }

    try {
        // Handle very small numbers
        if (Math.abs(number) < 0.000001 && number !== 0) {
            return number.toExponential(decimals);
        }

        if (compact && Math.abs(number) >= 1000) {
            const units = ['', 'K', 'M', 'B', 'T'];
            const unitIndex = Math.min(
                Math.floor(Math.log10(Math.abs(number)) / 3),
                units.length - 1
            );
            const scaled = number / Math.pow(1000, unitIndex);
            return `${scaled.toFixed(decimals)}${units[unitIndex]}`;
        }

        return new Intl.NumberFormat('en-US', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        }).format(number);
    } catch (error) {
        console.error('Error formatting number:', error, number);
        return number.toString();
    }
}

/**
 * Debounce function to limit how often a function can be called
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @param {boolean} immediate - Whether to call immediately
 * @returns {Function} Debounced function
 */
function debounce(func, wait, immediate = false) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            timeout = null;
            if (!immediate) func.apply(this, args);
        };
        const callNow = immediate && !timeout;
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
        if (callNow) func.apply(this, args);
    };
}

/**
 * Format currency values
 * @param {number} amount - The amount to format
 * @param {string} currency - Currency code (default: 'XRP')
 * @param {number} decimals - Decimal places (default: 6)
 * @returns {string} Formatted currency string
 */
function formatCurrency(amount, currency = 'XRP', decimals = 6) {
    const formatted = formatNumber(amount, decimals);
    return `${formatted} ${currency}`;
}

/**
 * Truncate middle of string for addresses
 * @param {string} str - String to truncate
 * @param {number} startChars - Number of starting characters to keep
 * @param {number} endChars - Number of ending characters to keep
 * @param {string} separator - Separator string (default: '...')
 * @returns {string} Truncated string
 */
function truncateMiddle(str, startChars = 6, endChars = 4, separator = '...') {
    if (!str || str.length <= startChars + endChars) return str;
    return str.substring(0, startChars) + separator + str.substring(str.length - endChars);
}

/**
 * Generate random ID
 * @param {number} length - Length of ID
 * @returns {string} Random ID
 */
function generateId(length = 8) {
    return Math.random().toString(36).substring(2, 2 + length);
}

/**
 * Check if value is empty (null, undefined, empty string, empty array, empty object)
 * @param {*} value - Value to check
 * @returns {boolean} True if empty
 */
function isEmpty(value) {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string') return value.trim() === '';
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === 'object') return Object.keys(value).length === 0;
    return false;
}

/**
 * Deep clone an object
 * @param {*} obj - Object to clone
 * @returns {*} Cloned object
 */
function deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return new Date(obj.getTime());
    if (obj instanceof Array) return obj.map(item => deepClone(item));
    if (obj instanceof Object) {
        const clonedObj = {};
        Object.keys(obj).forEach(key => {
            clonedObj[key] = deepClone(obj[key]);
        });
        return clonedObj;
    }
}

/**
 * Validate XRP address format
 * @param {string} address - XRP address to validate
 * @returns {boolean} True if valid
 */
function isValidXRPAddress(address) {
    if (!address || typeof address !== 'string') return false;
    // Basic XRP address validation - r... followed by 25-35 alphanumeric chars
    const xrpAddressRegex = /^r[1-9A-HJ-NP-Za-km-z]{25,34}$/;
    return xrpAddressRegex.test(address);
}

/**
 * Sleep/delay function
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise} Promise that resolves after delay
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Copy text to clipboard
 * @param {string} text - Text to copy
 * @returns {Promise<boolean>} Success status
 */
async function copyToClipboard(text) {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return true;
        } else {
            // Fallback for older browsers
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.style.position = 'fixed';
            textArea.style.left = '-999999px';
            textArea.style.top = '-999999px';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            const successful = document.execCommand('copy');
            document.body.removeChild(textArea);
            return successful;
        }
    } catch (err) {
        console.error('Failed to copy text: ', err);
        return false;
    }
}

/**
 * Show notification to user
 * @param {string} message - Message to display
 * @param {string} type - Type of notification (success, error, info, warning)
 * @param {number} duration - Duration in milliseconds (default: 5000)
 */
function showNotification(message, type = 'info', duration = 5000) {
    // Remove existing notifications
    const existingNotifications = document.querySelectorAll('.notification');
    existingNotifications.forEach(notif => notif.remove());

    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    // Trigger animation
    setTimeout(() => notification.classList.add('show'), 100);
    
    // Auto remove after duration
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 300);
    }, duration);
}

/**
 * Get readable file size
 * @param {number} bytes - File size in bytes
 * @returns {string} Readable file size
 */
function getReadableFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Escape HTML special characters
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Format date to readable string
 * @param {Date|string} date - Date to format
 * @param {Object} options - Intl.DateTimeFormat options
 * @returns {string} Formatted date
 */
function formatDate(date, options = {}) {
    const defaultOptions = {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    };
    
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    return new Intl.DateTimeFormat('en-US', { ...defaultOptions, ...options }).format(dateObj);
}

/**
 * Calculate percentage
 * @param {number} value - Current value
 * @param {number} total - Total value
 * @param {number} decimals - Decimal places (default: 2)
 * @returns {number} Percentage
 */
function calculatePercentage(value, total, decimals = 2) {
    if (total === 0) return 0;
    return parseFloat(((value / total) * 100).toFixed(decimals));
}

/**
 * Generate random color
 * @returns {string} Hex color code
 */
function getRandomColor() {
    return '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
}

/**
 * Throttle function calls
 * @param {Function} func - Function to throttle
 * @param {number} limit - Time limit in milliseconds
 * @returns {Function} Throttled function
 */
function throttle(func, limit) {
    let inThrottle;
    return function(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        formatNumber,
        debounce,
        formatCurrency,
        truncateMiddle,
        generateId,
        isEmpty,
        deepClone,
        isValidXRPAddress,
        sleep,
        copyToClipboard,
        showNotification,
        getReadableFileSize,
        escapeHtml,
        formatDate,
        calculatePercentage,
        getRandomColor,
        throttle
    };
}

console.log('🔧 Utilities module loaded');
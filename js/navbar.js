// navbar.js - Enhanced Navbar Functionality

document.addEventListener('DOMContentLoaded', function() {
  initNavbar();
});

function initNavbar() {
  initHamburgerMenu();
  initDropdowns();
  initNavbarToggle();
}

function initHamburgerMenu() {
  const hamburger = document.getElementById('hamburger');
  const navLinks = document.getElementById('navLinks');

  if (!hamburger || !navLinks) return;

  hamburger.addEventListener('click', function(e) {
    e.stopPropagation();
    hamburger.classList.toggle('active');
    navLinks.classList.toggle('show');
    document.body.classList.toggle('mobile-menu-open');
  });

  // Close mobile menu when clicking a nav button (except dropdown toggles)
  navLinks.querySelectorAll('.nav-btn:not(.dropdown-toggle)').forEach(btn => {
    btn.addEventListener('click', () => {
      if (window.innerWidth <= 992) {
        closeMobileMenu();
      }
    });
  });

  // Close mobile menu when clicking outside
  document.addEventListener('click', function(e) {
    if (window.innerWidth <= 992 && 
        !e.target.closest('.nav-links') && 
        !e.target.closest('.hamburger')) {
      closeMobileMenu();
    }
  });
}

function initDropdowns() {
  // Mobile dropdown toggle functionality
  document.querySelectorAll('.dropdown-toggle').forEach(toggle => {
    toggle.addEventListener('click', function(e) {
      // Only handle mobile behavior
      if (window.innerWidth > 992) {
        e.preventDefault();
        return; // Let CSS handle hover on desktop
      }
      
      e.preventDefault();
      e.stopPropagation();

      const dropdown = this.closest('.nav-dropdown');
      const isActive = dropdown.classList.contains('active');

      // Close all other dropdowns
      document.querySelectorAll('.nav-dropdown').forEach(d => {
        if (d !== dropdown) {
          d.classList.remove('active');
        }
      });

      // Toggle current dropdown
      dropdown.classList.toggle('active', !isActive);
    });
  });

  // Close dropdowns when clicking outside on mobile
  document.addEventListener('click', function(e) {
    if (window.innerWidth <= 992) {
      if (!e.target.closest('.nav-dropdown')) {
        document.querySelectorAll('.nav-dropdown').forEach(dropdown => {
          dropdown.classList.remove('active');
        });
      }
    }
  });

  // Close dropdowns when clicking a dropdown item on mobile
  document.querySelectorAll('.dropdown-item').forEach(item => {
    item.addEventListener('click', function() {
      if (window.innerWidth <= 992) {
        closeAllDropdowns();
        closeMobileMenu();
      }
    });
  });

  // Reset dropdowns on window resize
  window.addEventListener('resize', function() {
    if (window.innerWidth > 992) {
      closeAllDropdowns();
      closeMobileMenu();
    }
  });
}

function initNavbarToggle() {
  const navbar = document.getElementById('navbar');
  const toggleBtn = document.getElementById('navbarToggle');
  
  if (!navbar || !toggleBtn) return;

  // Toggle navbar visibility
  toggleBtn.addEventListener('click', function() {
    navbar.classList.toggle('hide');
  });

  // Keyboard shortcut (N key)
  document.addEventListener('keydown', function(e) {
    if (e.key.toLowerCase() === 'n' && !e.target.matches('input, textarea')) {
      navbar.classList.toggle('hide');
    }
  });

  // Auto-hide navbar on scroll
  let lastScrollY = window.scrollY;
  window.addEventListener('scroll', function() {
    if (window.innerWidth > 992) { // Only on desktop
      if (window.scrollY > lastScrollY && window.scrollY > 100) {
        navbar.classList.add('hide');
      } else if (window.scrollY < lastScrollY) {
        navbar.classList.remove('hide');
      }
      lastScrollY = window.scrollY;
    }
  });
}

// Utility functions
function closeMobileMenu() {
  const hamburger = document.getElementById('hamburger');
  const navLinks = document.getElementById('navLinks');
  
  if (hamburger && navLinks) {
    hamburger.classList.remove('active');
    navLinks.classList.remove('show');
    document.body.classList.remove('mobile-menu-open');
  }
}

function closeAllDropdowns() {
  document.querySelectorAll('.nav-dropdown').forEach(dropdown => {
    dropdown.classList.remove('active');
  });
}

// Make functions globally available
window.closeMobileMenu = closeMobileMenu;
window.closeAllDropdowns = closeAllDropdowns;
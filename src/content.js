const debounce = (func, wait) => {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
};

// Function to gather webpage context
const getWebpageContext = (element) => {
  console.log("getWebpageContext called with element:", element);
  if (!element || !(element instanceof Element)) {
    console.warn("Invalid element passed to getWebpageContext: ", element);
    return JSON.stringify({
      url: window.location.href,
      title: document.title,
      path: window.location.pathname,
      elementContext: "",
    });
  }

  const context = {
    url: window.location.href,
    title: document.title,
    path: window.location.pathname,
    elementContext: "",
  };

  // Get context of the element's location in the page
  // Get parent elements up to 3 levels
  let parentContext = [];
  let currentElement = element;
  for (let i = 0; i < 3; i++) {
    if (currentElement.parentElement) {
      currentElement = currentElement.parentElement;
      const tagName = currentElement.tagName.toLowerCase();
      const id = currentElement.id ? `#${currentElement.id}` : "";
      const className = currentElement.className
        ? `.${currentElement.className.split(" ").join(".")}`
        : "";
      parentContext.unshift(`${tagName}${id}${className}`);
    }
  }

  // Get nearby headings
  const nearbyHeadings = [];
  const headings = document.querySelectorAll("h1, h2, h3, h4, h5, h6");
  const elementRect = element.getBoundingClientRect();
  headings.forEach(heading => {
    const headingRect = heading.getBoundingClientRect();
    if (Math.abs(headingRect.top - elementRect.top) < 500) {
      // Within 500px
      nearbyHeadings.push(
        `${heading.tagName.toLowerCase()}: ${heading.textContent}`
      );
    }
  });
  
  context.elementContext = {
    parents: parentContext,
    nearbyHeadings: nearbyHeadings,
    tagName: element.tagName.toLowerCase(),
    id: element.id || "",
    className: element.className || "",
  };

  const finalContext = JSON.stringify(context);
  console.log("Generated context:", finalContext);
  return finalContext;
};

// call backend route to handle the autocompletion
const getCompletion = async (message) => {
  console.log("getCompletion called with message:", message);
  const context = getWebpageContext(message); // pass the element or message here
  console.log("Context in getCompletion:", context);

  const response = await fetch("https://autotab-backend.vercel.app/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message, context }),
  });
  if (!response.ok) {
    throw new Error("Failed to get completion");
  }
  const data = await response.json();
  try {
    // Try to parse the response as JSON if it's a string
    const parsedResponse =
      typeof data.response === "string"
        ? JSON.parse(data.response)
        : data.response;
    return parsedResponse.response || parsedResponse;
  } catch (e) {
    // If parsing fails, return the original response
    return data.response;
  }
};

// display text completion on the front end
class SuggestionOverlay {
  constructor() {
    this.overlay = document.createElement("div");
    this.overlay.className = "ai-suggestion-overlay";
    this.overlay.style.cssText = `
    position: absolute;
    pointer-events: none;
    color: #9CA3AF;
    font-family: monospace; 
    white-space: pre;
    z-index: 10000;
    background: transparent;
    `;
    document.body.appendChild(this.overlay);
  }

  //show method
  show(element, suggestion, cursorPosition) {
    const rect = element.getBoundingClientRect();
    const computedStyle = window.getComputedStyle(element);
    const measureSpan = document.createElement("span");

    measureSpan.style.cssText = `
    position: absolute;
    visibility: hidden;
    font-family: ${computedStyle.fontFamily};
    font-size: ${computedStyle.fontSize};
    letter-spacing: ${computedStyle.letterSpacing};
    white-space: pre`;

    measureSpan.textContent = element.value.slice(0, cursorPosition);
    document.body.appendChild(measureSpan);

    const textWidth = measureSpan.getBoundingClientRect().width;
    document.body.removeChild(measureSpan);

    this.overlay.style.top = `${rect.top + window.scrollY}px`;
    this.overlay.style.left = `${rect.left + window.scrollX + textWidth}px`;
    this.overlay.style.height = computedStyle.lineHeight;
    this.overlay.style.padding = computedStyle.padding;
    this.overlay.style.fontSize = computedStyle.fontSize;
    this.overlay.style.fontFamily = computedStyle.fontFamily;
    this.overlay.style.letterSpacing = computedStyle.letterSpacing;
    this.overlay.style.lineHeight = computedStyle.lineHeight;

    // Only show the suggestion
    this.overlay.textContent = suggestion;
    this.overlay.style.display = "block";
  }

  //hide display
  hide() {
    this.overlay.style.display = "none";
  }
}

//AI completion class
class AICompletion {
  constructor() {
    this.currentElement = null;
    this.suggestion = "";
    this.overlay = new SuggestionOverlay();
    this.cursorPosition = 0;
    this.debouncedGetSuggestions = debounce(
      this.getSuggestions.bind(this),
      500
    );
    this.setupEventListeners();
  }

  async getSuggestions(text, cursorPosition) {
    if (!text.trim()) {
      this.suggestion = "";
      this.overlay.hide();
      return;
    }
    try {
      const suggestion = await getCompletion(text, this.currentElement);
      this.suggestion = suggestion.trim();
      if (this.currentElement && this.suggestion) {
        this.overlay.show(this.currentElement, this.suggestion, cursorPosition);
      }
    } catch (error) {
      console.error("Error getting suggestions:", error);
      this.suggestion = "";
      this.overlay.hide();
    }
  }

  handleInput(event) {
    const element = event.target;
    this.currentElement = element;
    this.cursorPosition = element.selectionStart;
    this.debouncedGetSuggestions(element.value, this.cursorPosition);
  }

  handleKeyDown(event) {
    if (event.key === "Tab" && this.suggestion) {
      event.preventDefault();
      const element = event.target;
      const beforeCursor = element.value.slice(0, this.cursorPosition);
      const afterCursor = element.value.slice(this.cursorPosition);
      element.value = beforeCursor + this.suggestion + afterCursor;

      // Move cursor to end of inserted suggestion
      const newCursorPosition = this.cursorPosition + this.suggestion.length;
      element.setSelectionRange(newCursorPosition, newCursorPosition);

      this.suggestion = "";
      this.overlay.hide();
    }
  }

  handleSelectionChange(event) {
    if (this.currentElement === event.target) {
      this.cursorPosition = event.target.selectionStart;
      if (this.suggestion) {
        this.overlay.show(
          this.currentElement,
          this.suggestion,
          this.cursorPosition
        );
      }
    }
  }

  handleFocus(event) {
    this.currentElement = event.target;
    this.cursorPosition = event.target.selectionStart;
    if (event.target.value && this.suggestion) {
      this.overlay.show(event.target, this.suggestion, this.cursorPosition);
    }
  }
  handleBlur() {
    this.currentElement = null;
    this.overlay.hide();
  }

  setupEventListeners() {
    document.addEventListener("input", this.handleInput.bind(this), true);
    document.addEventListener("keydown", this.handleKeyDown.bind(this), true);
    document.addEventListener("focus", this.handleFocus.bind(this), true);
    document.addEventListener("blur", this.handleBlur.bind(this), true);
    document.addEventListener(
      "selectionchange",
      this.handleSelectionChange.bind(this),
      true
    );
  }
}

new AICompletion();

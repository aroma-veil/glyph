
(() => {
    "use strict";

    function insertChipAtCursor(chip) {
        const selection = window.getSelection();

        if (!selection || !selection.rangeCount) {
            editor.appendChild(chip);
        } else {
            const range = selection.getRangeAt(0);
            range.deleteContents();
            range.insertNode(chip);
        }

        // always create an editable text node after the chip
        const spacer = document.createTextNode('\u200B');
        chip.after(spacer);

        // move the caret into the new text node
        const range = document.createRange();
        range.setStart(spacer, 1);
        range.collapse(true);

        selection.removeAllRanges();
        selection.addRange(range);

        editor.focus();
    }

    const $ = selector => document.querySelector(selector);

    const editor = $("#editor");
    const output = $("#jsonOutput");

    let savedRange = null;
    let editingToken = null;
    let modalType = "";
    let pretty = true;

    let history = [];
    let historyIndex = -1;
    let restoring = false;

    const symbols = {
        ornaments: [
            "✦", "✧", "◆", "◇", "♦", "♢", "★",
            "☆", "✶", "✷", "✹", "※", "⁕", "⁂"
        ],

        shapes: [
            "•", "◦", "▪", "▫", "■", "□", "▣",
            "▢", "▸", "▹", "●", "○", "◉", "⊙"
        ],

        arrows: [
            "➤", "➜", "➔", "→", "←", "↑", "↓",
            "↗", "↘", "↔", "⇢", "⇠", "➟"
        ],

        cards: [
            "♠", "♣", "♥", "♦", "♤", "♧",
            "♡", "♢", "♜", "♞", "♛", "♚"
        ],

        fantasy: [
            "⚔", "⚒", "⚓", "⚑", "⚡", "☠",
            "☯", "☄", "☘", "☀", "☂", "⛏",
            "🗡", "🛡", "🔱", "🎯"
        ]
    };

    let palette = [
        { name: "mint", hex: "#a7d7bd" },
        { name: "violet", hex: "#b69cff" },
        { name: "gold", hex: "#e8c879" },
        { name: "rose", hex: "#e99aa8" },
        { name: "ice", hex: "#91c9df" }
    ];

    /* --------------------------------------------------
       PALETTE STORAGE
    -------------------------------------------------- */

    try {
        const stored = JSON.parse(
            localStorage.getItem("glyph-palette") || "null"
        );

        if (Array.isArray(stored)) {
            palette = stored.filter(color =>
                color &&
                typeof color.name === "string" &&
                /^#[0-9a-f]{6}$/i.test(color.hex)
            );
        }
    } catch {
        // Invalid stored palette: use defaults.
    }

    function savePalette() {
        localStorage.setItem(
            "glyph-palette",
            JSON.stringify(palette)
        );
    }

    /* --------------------------------------------------
       EDITOR SELECTION
    -------------------------------------------------- */

    function saveSelection() {
        const selection = window.getSelection();

        if (
            selection.rangeCount &&
            editor.contains(selection.anchorNode)
        ) {
            savedRange = selection.getRangeAt(0).cloneRange();
        }
    }

    function restoreSelection() {
        if (!savedRange) return;

        const selection = window.getSelection();

        selection.removeAllRanges();
        selection.addRange(savedRange);
    }

    function focusEditor() {
        editor.focus();
        restoreSelection();
    }

    function insertText(text) {
        focusEditor();

        const selection = window.getSelection();

        let range = selection.rangeCount
            ? selection.getRangeAt(0)
            : document.createRange();

        if (!editor.contains(range.startContainer)) {
            range.selectNodeContents(editor);
            range.collapse(false);
        }

        range.deleteContents();

        const node = document.createTextNode(text);

        range.insertNode(node);
        range.setStartAfter(node);
        range.collapse(true);

        selection.removeAllRanges();
        selection.addRange(range);

        saveSelection();
        changed();
    }

    /* --------------------------------------------------
       FORMATTING
    -------------------------------------------------- */

    function applyCommand(command) {
        focusEditor();

        document.execCommand(
            "styleWithCSS",
            false,
            true
        );

        document.execCommand(command, false, null);

        changed();
    }

    
function applyColor(color) {
    focusEditor();

    const selection = window.getSelection();

    if (!selection || !selection.rangeCount) {
        return;
    }

    const range = selection.getRangeAt(0);

    if (!editor.contains(range.commonAncestorContainer)) {
        return;
    }

    // no selected text: use the browser's formatting command
    // to set the color for subsequently typed text
    if (range.collapsed) {
        document.execCommand("styleWithCSS", false, true);
        document.execCommand("foreColor", false, color);

        saveSelection();
        changed();
        return;
    }

    // wrap selected content in an explicitly colored span
    const span = document.createElement("span");
    span.style.color = color;

    span.appendChild(range.extractContents());
    range.insertNode(span);

    // keep the newly colored text selected
    const newRange = document.createRange();
    newRange.selectNodeContents(span);

    selection.removeAllRanges();
    selection.addRange(newRange);

    saveSelection();
    changed();
}

    document.querySelectorAll("[data-command]").forEach(button => {
        button.addEventListener("click", () => {
            applyCommand(button.dataset.command);
        });
    });

    $("#textColor").addEventListener("change", event => {
        applyColor(event.target.value);
    });
    
    $("#namedColor").addEventListener("change", event => {
        if (event.target.value) {
            applyColor(event.target.value);
            event.target.value = "";
        }
    });

    $("#resetStyle").addEventListener("click", () => {
        focusEditor();

        document.execCommand("removeFormat");

        editor.querySelectorAll("[data-obfuscated]").forEach(node => {
            node.replaceWith(...node.childNodes);
        });

        changed();
    });

    $("#obfuscate").addEventListener("click", () => {
        focusEditor();

        const selection = window.getSelection();

        if (!selection.rangeCount || selection.isCollapsed) {
            return;
        }

        const range = selection.getRangeAt(0);
        const span = document.createElement("span");

        span.dataset.obfuscated = "true";

        try {
            range.surroundContents(span);
        } catch {
            document.execCommand(
                "insertHTML",
                false,
                `<span data-obfuscated="true">${selection.toString()}</span>`
            );
        }

        changed();
    });

    /* --------------------------------------------------
       SYMBOL PICKER
    -------------------------------------------------- */

    Object.entries(symbols).forEach(([category, characters]) => {
        const container = document.querySelector(
            `[data-symbols="${category}"]`
        );

        characters.forEach(character => {
            const button = document.createElement("button");

            button.type = "button";
            button.textContent = character;
            button.title = `insert ${character}`;

            button.addEventListener("mousedown", event => {
                event.preventDefault();
            });

            button.addEventListener("click", () => {
                insertText(character);
                $("#symbolMenu").classList.remove("open");
            });

            container.appendChild(button);
        });
    });

    const symbolToggle = $('#symbolToggle');
    const symbolMenu = $('#symbolMenu');

    // move the menu outside the editor and toolbar hierarchy
    document.body.appendChild(symbolMenu);

    function positionSymbolMenu() {
        const rect = symbolToggle.getBoundingClientRect();
        const menuWidth = Math.min(330, window.innerWidth - 24);
        const menuHeight = Math.min(420, window.innerHeight - 24);

        let left = rect.left;
        let top = rect.bottom + 6;

        // keep the menu inside the horizontal viewport
        left = Math.max(12, Math.min(left, window.innerWidth - menuWidth - 12));

        // open upwards if there isn't enough room below
        if (top + menuHeight > window.innerHeight - 12) {
            top = rect.top - menuHeight - 6;
        }

        // final vertical boundary check
        top = Math.max(12, Math.min(top, window.innerHeight - menuHeight - 12));

        symbolMenu.style.left = `${left}px`;
        symbolMenu.style.top = `${top}px`;
    }

    symbolToggle.addEventListener('click', () => {
        const isOpen = symbolMenu.classList.toggle('open');

        symbolToggle.setAttribute('aria-expanded', String(isOpen));

        if (isOpen) {
            positionSymbolMenu();
        }

        saveRange();
    });

    // close when clicking outside the button and menu
    document.addEventListener('mousedown', event => {
        if (
            !symbolMenu.contains(event.target) &&
            !symbolToggle.contains(event.target)
        ) {
            symbolMenu.classList.remove('open');
            symbolToggle.setAttribute('aria-expanded', 'false');
        }
    });

    // keep the menu anchored to the button
    window.addEventListener('resize', () => {
        if (symbolMenu.classList.contains('open')) {
            positionSymbolMenu();
        }
    });

    window.addEventListener('scroll', () => {
        if (symbolMenu.classList.contains('open')) {
            positionSymbolMenu();
        }
    }, true);

    /* --------------------------------------------------
       COMPONENT MODAL
    -------------------------------------------------- */

    function addField(key, label, placeholder = "", value = "", wide = false) {
        const wrapper = document.createElement("div");

        wrapper.className = wide ? "field wide" : "field";

        const labelElement = document.createElement("label");
        labelElement.textContent = label;

        const input = document.createElement("input");

        input.dataset.key = key;
        input.placeholder = placeholder;
        input.value = value;

        wrapper.append(labelElement, input);

        return wrapper;
    }

    function addSelect(key, label, options, value) {
        const wrapper = document.createElement("div");
        wrapper.className = "field";

        const labelElement = document.createElement("label");
        labelElement.textContent = label;

        const select = document.createElement("select");
        select.dataset.key = key;

        options.forEach(option => {
            const element = document.createElement("option");

            element.value = option.value;
            element.textContent = option.label;
            element.selected = option.value === value;

            select.appendChild(element);
        });

        wrapper.append(labelElement, select);

        return wrapper;
    }

    function openModal(type, token = null) {
        saveSelection();

        modalType = type;
        editingToken = token;

        const data = token
            ? JSON.parse(token.dataset.data || "{}")
            : {};

        const fields = $("#modalFields");

        fields.replaceChildren();

        const descriptions = {
            keybind: "Insert a keyboard binding component.",
            selector: "Display the result of an entity selector.",
            score: "Display a scoreboard value.",
            translate: "Insert a translation component.",
            nbt: "Display an NBT value."
        };

        $("#modalTitle").textContent = `Insert ${type}`;
        $("#modalDescription").textContent =
            descriptions[type];

        if (type === "keybind") {
            fields.append(
                addField(
                    "keybind",
                    "Keybind identifier",
                    "key.jump",
                    data.keybind || "key.jump",
                    true
                )
            );
        }

        if (type === "selector") {
            fields.append(
                addField(
                    "selector",
                    "Entity selector",
                    "@p",
                    data.selector || "@p",
                    true
                ),
                addField(
                    "separator",
                    "Separator JSON (optional)",
                    '{"text":", "}',
                    data.separator || "",
                    true
                )
            );
        }

        if (type === "score") {
            fields.append(
                addField("name", "Score holder", "@p", data.name || "@p"),
                addField(
                    "objective",
                    "Objective",
                    "kills",
                    data.objective || "kills"
                ),
                addField("value", "Override value", "", data.value || "")
            );
        }

        if (type === "translate") {
            fields.append(
                addField(
                    "translate",
                    "Translation key",
                    "chat.type.text",
                    data.translate || "chat.type.text",
                    true
                ),
                addField(
                    "fallback",
                    "Fallback text",
                    "",
                    data.fallback || "",
                    true
                ),
                addField(
                    "with",
                    "Arguments JSON array",
                    '["player"]',
                    data.with || "",
                    true
                )
            );
        }

        if (type === "nbt") {
            fields.append(
                addField(
                    "nbt",
                    "NBT path",
                    "Inventory",
                    data.nbt || "Inventory",
                    true
                ),
                addSelect(
                    "source",
                    "Source",
                    [
                        { value: "entity", label: "entity" },
                        { value: "block", label: "block" },
                        { value: "storage", label: "storage" }
                    ],
                    data.source || "entity"
                ),
                addField(
                    "target",
                    "Source target",
                    "@s / ~ ~ ~ / namespace:id",
                    data.target || "@s"
                ),
                addSelect(
                    "interpret",
                    "Interpret",
                    [
                        { value: "false", label: "false" },
                        { value: "true", label: "true" }
                    ],
                    data.interpret || "false"
                )
            );
        }

        $("#modalBackdrop").classList.add("open");
    }

    function closeModal() {
        $("#modalBackdrop").classList.remove("open");
    }

    $("#insertComponent").addEventListener("click", () => {
        openModal($("#componentType").value);
    });

    $("#cancelModal").addEventListener("click", closeModal);

    $("#confirmModal").addEventListener("click", () => {
        const data = {};

        $("#modalFields").querySelectorAll("[data-key]").forEach(input => {
            data[input.dataset.key] = input.value;
        });

        try {
            if (data.with) JSON.parse(data.with);
            if (data.separator) JSON.parse(data.separator);
        } catch {
            $("#modalDescription").textContent =
                "One of the JSON fields is invalid.";
            return;
        }

        const chip = editingToken || document.createElement("span");

        chip.dataset.token = modalType;
        chip.dataset.data = JSON.stringify(data);
        chip.contentEditable = "false";

        const labels = {
            keybind: `⌨ ${data.keybind}`,
            selector: `◎ ${data.selector}`,
            score: `▤ ${data.name} · ${data.objective}`,
            translate: `文 ${data.translate}`,
            nbt: `◇ ${data.nbt} (${data.source})`
        };

        chip.textContent = labels[modalType];
        chip.title = "click to edit component";

        if (!editingToken) {
            focusEditor();

            const selection = window.getSelection();

            let range = selection.rangeCount
                ? selection.getRangeAt(0)
                : document.createRange();

            if (!editor.contains(range.startContainer)) {
                range.selectNodeContents(editor);
                range.collapse(false);
            }

            range.deleteContents();
            insertChipAtCursor(chip);

            const spacer = document.createTextNode("\u00a0");

            chip.after(spacer);

            range.setStartAfter(spacer);
            range.collapse(true);

            selection.removeAllRanges();
            selection.addRange(range);

            saveSelection();
        }

        closeModal();
        changed();
    });

    editor.addEventListener("click", event => {
        const token = event.target.closest("[data-token]");

        if (token) {
            openModal(token.dataset.token, token);
        }

        saveSelection();
    });

    /* --------------------------------------------------
       SERIALIZATION
    -------------------------------------------------- */

    function normalizeColor(color) {
        const match = color.match(/\d+/g);

        if (!match || match.length < 3) {
            return color;
        }

        return "#" + match
            .slice(0, 3)
            .map(value => Number(value).toString(16).padStart(2, "0"))
            .join("");
    }

    function tokenToComponent(node) {
        const type = node.dataset.token;
        const data = JSON.parse(node.dataset.data || "{}");

        switch (type) {
            case "keybind":
                return {
                    keybind: data.keybind
                };

            case "selector": {
                const component = {
                    selector: data.selector
                };

                if (data.separator) {
                    component.separator = JSON.parse(data.separator);
                }

                return component;
            }

            case "score": {
                const component = {
                    score: {
                        name: data.name,
                        objective: data.objective
                    }
                };

                if (data.value) {
                    component.score.value = data.value;
                }

                return component;
            }

            case "translate": {
                const component = {
                    translate: data.translate
                };

                if (data.fallback) {
                    component.fallback = data.fallback;
                }

                if (data.with) {
                    component.with = JSON.parse(data.with);
                }

                return component;
            }

            case "nbt": {
                const component = {
                    nbt: data.nbt,
                    [data.source || "entity"]: data.target || "@s"
                };

                if (data.interpret === "true") {
                    component.interpret = true;
                }

                return component;
            }
        }
    }

    function serializeNode(node, inherited = {}, result = []) {
        for (const child of node.childNodes) {

            if (child.nodeType === Node.TEXT_NODE) {
                if (child.nodeValue) {
                    result.push({
                        text: child.nodeValue.replace(/\u00a0/g, " "),
                        ...inherited
                    });
                }

                continue;
            }

            if (child.nodeType !== Node.ELEMENT_NODE) {
                continue;
            }

            if (child.dataset.token) {
                result.push(tokenToComponent(child));
                continue;
            }

            if (child.tagName === "BR") {
                result.push({
                    text: "\n",
                    ...inherited
                });

                continue;
            }

            const style = child.style || {};
            const next = { ...inherited };

            if (
                child.tagName === "B" ||
                child.tagName === "STRONG" ||
                style.fontWeight === "bold" ||
                Number.parseInt(style.fontWeight) >= 600
            ) {
                next.bold = true;
            }

            if (
                child.tagName === "I" ||
                child.tagName === "EM" ||
                style.fontStyle === "italic"
            ) {
                next.italic = true;
            }

            if (
                child.tagName === "U" ||
                (style.textDecoration || "").includes("underline") ||
                (style.textDecorationLine || "").includes("underline")
            ) {
                next.underlined = true;
            }

            if (
                child.tagName === "S" ||
                child.tagName === "STRIKE" ||
                (style.textDecoration || "").includes("line-through") ||
                (style.textDecorationLine || "").includes("line-through")
            ) {
                next.strikethrough = true;
            }

            if (style.color) {
                next.color = normalizeColor(style.color);
            }

            if (child.dataset.obfuscated === "true") {
                next.obfuscated = true;
            }

            const start = result.length;

            serializeNode(child, next, result);

            // Block elements represent line breaks between paragraphs,
            // not after the final paragraph.
            if (
                (child.tagName === "DIV" || child.tagName === "P") &&
                child.nextSibling &&
                result.length > start
            ) {
                const last = result[result.length - 1];

                if (
                    last.text !== undefined &&
                    !last.text.endsWith("\n")
                ) {
                    result.push({
                        text: "\n",
                        ...inherited
                    });
                }
            }
        }

        return result;
    }

    function mergeComponents(components) {
        const result = [];

        const styleKeys = [
            "color",
            "bold",
            "italic",
            "underlined",
            "strikethrough",
            "obfuscated"
        ];

        for (const component of components) {
            if (component.text === "") {
                continue;
            }

            const previous = result[result.length - 1];

            const canMerge =
                component.text !== undefined &&
                previous?.text !== undefined &&
                styleKeys.every(key =>
                    (component[key] ?? null) ===
                    (previous[key] ?? null)
                );

            if (canMerge) {
                previous.text += component.text;
            } else {
                result.push({ ...component });
            }
        }

        // Never leave a trailing empty text fragment.
        while (
            result.length &&
            result[result.length - 1].text === ""
        ) {
            result.pop();
        }

        return result;
    }

    function getComponents() {
        const content = mergeComponents(
            serializeNode(editor)
        );

        /*
         * OUTPUT CONTRACT:
         *
         * Every generated array begins with exactly:
         * {"text":""}
         *
         * The user's actual content follows it.
         */

        return [
            { text: "" },
            ...content
        ];
    }

    function convertLegacy(component) {
        const result = { ...component };

        if (result.clickEvent) {
            result.click_event = result.clickEvent;
            delete result.clickEvent;
        }

        if (result.hoverEvent) {
            result.hover_event = result.hoverEvent;
            delete result.hoverEvent;
        }

        return result;
    }

    function buildOutput() {
        let components = getComponents();

        if ($("#format").value === "legacy") {
            components = components.map(convertLegacy);
        }

        return components;
    }

    /* --------------------------------------------------
       PREVIEW
    -------------------------------------------------- */

    function updatePreview(components) {
        const preview = $("#preview");

        preview.replaceChildren();

        components.forEach(component => {
            const span = document.createElement("span");

            if (component.text !== undefined) {
                span.textContent = component.text;
            } else if (component.keybind) {
                span.textContent = `[${component.keybind}]`;
            } else if (component.selector) {
                span.textContent = component.selector;
            } else if (component.score) {
                span.textContent =
                    `${component.score.name}:${component.score.objective}`;
            } else if (component.translate) {
                span.textContent =
                    component.fallback || component.translate;
            } else if (component.nbt) {
                span.textContent = `[NBT: ${component.nbt}]`;
            }

            span.style.color = component.color || "#e8eeeb";
            span.style.fontWeight = component.bold ? "700" : "400";
            span.style.fontStyle = component.italic ? "italic" : "normal";

            const decorations = [];

            if (component.underlined) {
                decorations.push("underline");
            }

            if (component.strikethrough) {
                decorations.push("line-through");
            }

            span.style.textDecoration = decorations.join(" ");

            preview.appendChild(span);
        });
    }

    /* --------------------------------------------------
       JSON OUTPUT
    -------------------------------------------------- */

    function updateOutput() {
        try {
            const components = buildOutput();

            const json = JSON.stringify(
                components,
                null,
                pretty ? 2 : 0
            );

            /*
             * JSON.stringify does not append a newline.
             * Do not use json + "\n" or add a trailing line break.
             */
            output.textContent = json;

            $("#status").textContent =
                `valid JSON · ${json.length} chars`;

            $("#status").classList.remove("error");

            updatePreview(components);

        } catch (error) {
            output.textContent = `Invalid component: ${error.message}`;

            $("#status").textContent = "component error";
            $("#status").classList.add("error");
        }
    }

    /* --------------------------------------------------
       UNDO / REDO
    -------------------------------------------------- */

    function saveHistory() {
        if (restoring) return;

        const value = editor.innerHTML;

        if (history[historyIndex] === value) {
            return;
        }

        history = history.slice(0, historyIndex + 1);
        history.push(value);

        if (history.length > 100) {
            history.shift();
        }

        historyIndex = history.length - 1;
    }

    function restoreHistory(index) {
        if (index < 0 || index >= history.length) {
            return;
        }

        historyIndex = index;
        restoring = true;

        editor.innerHTML = history[index];

        restoring = false;

        updateOutput();
    }

    function changed() {
        updateOutput();
        saveHistory();
    }

    editor.addEventListener("input", changed);
    editor.addEventListener("keyup", saveSelection);
    editor.addEventListener("mouseup", saveSelection);
    editor.addEventListener("touchend", saveSelection);

    $("#undo").addEventListener("click", () => {
        restoreHistory(historyIndex - 1);
    });

    $("#redo").addEventListener("click", () => {
        restoreHistory(historyIndex + 1);
    });

    document.addEventListener("keydown", event => {
        if (
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === "z"
        ) {
            event.preventDefault();

            restoreHistory(
                historyIndex + (event.shiftKey ? 1 : -1)
            );
        }

        if (event.key === "Escape") {
            $("#modalBackdrop").classList.remove("open");
            $("#symbolMenu").classList.remove("open");
        }
    });

    /* --------------------------------------------------
       COLOR PALETTE
    -------------------------------------------------- */

    function validHex(value) {
        return /^#[0-9a-f]{6}$/i.test(value);
    }

    function syncColor(source) {
        let hex = source.value.trim();

        if (!validHex(hex)) {
            return;
        }

        hex = hex.toLowerCase();

        $("#colorHex").value = hex;
        $("#paletteColor").value = hex;

        $("#colorPreview").style.background = hex;
        $("#colorPreviewHex").textContent = hex.toUpperCase();
    }

    $("#paletteColor").addEventListener("input", () => {
        syncColor($("#paletteColor"));
    });

    $("#colorHex").addEventListener("input", () => {
        syncColor($("#colorHex"));
    });

    function drawPalette() {
        const container = $("#palette");

        container.replaceChildren();

        palette.forEach((color, index) => {
            const swatch = document.createElement("button");

            swatch.className = "swatch";
            swatch.style.background = color.hex;
            swatch.title = `${color.name} · ${color.hex}`;
            swatch.setAttribute(
                "aria-label",
                `${color.name} ${color.hex}`
            );

            swatch.addEventListener("click", () => {
                $("#textColor").value = color.hex;
                applyColor(color.hex);
            });

            // Right-click removes a custom palette entry.
            swatch.addEventListener("contextmenu", event => {
                event.preventDefault();

                if (confirm(`Remove "${color.name}" from the palette?`)) {
                    palette.splice(index, 1);
                    savePalette();
                    drawPalette();
                }
            });

            container.appendChild(swatch);
        });
    }

    $("#addColor").addEventListener("click", () => {
        const hex = $("#colorHex").value.trim();

        if (!validHex(hex)) {
            alert("Enter a valid hex color, such as #a7d7bd.");
            return;
        }

        palette.push({
            name: $("#colorName").value.trim() || "custom",
            hex: hex.toLowerCase()
        });

        savePalette();
        drawPalette();
    });

    $("#exportPalette").addEventListener("click", () => {
        const blob = new Blob(
            [JSON.stringify(palette, null, 2)],
            { type: "application/json" }
        );

        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");

        link.href = url;
        link.download = "glyph-palette.json";
        link.click();

        URL.revokeObjectURL(url);
    });

    $("#importPalette").addEventListener("click", () => {
        $("#paletteFile").click();
    });

    $("#paletteFile").addEventListener("change", async event => {
        const file = event.target.files[0];

        if (!file) return;

        try {
            const imported = JSON.parse(await file.text());

            if (
                !Array.isArray(imported) ||
                !imported.every(color =>
                    color &&
                    typeof color.name === "string" &&
                    validHex(color.hex)
                )
            ) {
                throw new Error("Invalid palette");
            }

            palette = imported;

            savePalette();
            drawPalette();

        } catch {
            alert("Invalid palette file.");
        }

        event.target.value = "";
    });

    /* --------------------------------------------------
       OUTPUT CONTROLS
    -------------------------------------------------- */

    $("#togglePretty").addEventListener("click", () => {
        pretty = !pretty;

        $("#togglePretty").textContent =
            pretty ? "compact" : "pretty";

        updateOutput();
    });

    $("#copyJson").addEventListener("click", () => {
        navigator.clipboard.writeText(output.textContent);
    });

    $("#copyCommand").addEventListener("click", () => {
        navigator.clipboard.writeText(
            "/tellraw @a " + output.textContent
        );
    });

    $("#downloadJson").addEventListener("click", () => {
        const blob = new Blob(
            [output.textContent],
            { type: "application/json" }
        );

        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");

        link.href = url;
        link.download = "minecraft-text.json";
        link.click();

        URL.revokeObjectURL(url);
    });

    $("#clear").addEventListener("click", () => {
        editor.replaceChildren();
        changed();
        editor.focus();
    });

    $("#format").addEventListener("change", updateOutput);

    $("#selectAll").addEventListener("click", () => {
        editor.focus();

        const range = document.createRange();

        range.selectNodeContents(editor);

        const selection = window.getSelection();

        selection.removeAllRanges();
        selection.addRange(range);

        saveSelection();
    });

    /* --------------------------------------------------
       INITIALIZATION
    -------------------------------------------------- */

    drawPalette();

    syncColor($("#colorHex"));

    editor.textContent = "Welcome, adventurer!";

    saveHistory();
    updateOutput();

})();

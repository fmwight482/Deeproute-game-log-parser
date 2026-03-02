/**
 * Optimized Deep Route Game Log Parser - CORRECTED VERSION
 * Performance improvements while preserving original extraction logic:
 * - Parallel fetching with concurrency control
 * - Cached regex patterns
 * - Better memory management
 * - Improved error handling and user feedback
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
    MAX_CONCURRENT_REQUESTS: 5, // Limit parallel requests to avoid overwhelming the server
    BUTTON_POSITION: { bottom: '20px', right: '20px' },
    COLORS: {
        primary: '#4CAF50',
        hover: '#45a049',
        disabled: '#cccccc',
        error: '#f44336'
    }
};

// ============================================================================
// REGEX PATTERNS (Pre-compiled for performance)
// ============================================================================

const PATTERNS = {
    year: /year=(\d+)/,
    quarterTime: /(Q[1-4]|OT)\s+(\d{1,2}:\d{2})/,
    down: /\((1st|2nd|3rd|4th)\s+and/,
    distance: /and\s+(Goal|inches?|i\s*n\s*c\s*h\s*e\s*s?|foot|&lt;\s*1|<\s*1|\d+)/i,
    fieldPos: /;\s*([^)]+)\)/,
    primaryOption: /primary option was\s+([A-Z0-9]+)/i,
    passTarget: /Pass by[\s\S]*?(?:to|DROPPED by)\s+([A-Z0-9]+)/i,
    amazingCatch: /AMAZING catch by\s+([A-Z0-9]+)/i,
    handoff: /Handoff to\s+([A-Z0-9]+)/i,
    snap: /The ball is snapped to\s+([A-Z0-9]+)/i,
    passBy: /Pass by\s+(?:QB\s+)?<a[^>]*?lookatplayer=(\d+)/i,
    handoffId: /Handoff to\s+(?:[A-Z0-9]+\s+)?<a[^>]*?lookatplayer=(\d+)/i,
    scoreUpdate: /(.+?)\s+(\d+),\s+(.+?)\s+(\d+)/,
    returnYards: /returned.*? (\d+) yards/,
    offensivePackage: /Offensive Package Was\s*:\s*(.*?)(?:\(|,)/,
    subPackage: /Offensive Package Was.*?\((.*?)\)/,
    formation: /Formation\s*:\s*(.*?)\s*,/,
    offPlay: /Play\s*:\s*(.*?)(?:\s*Defensive Package|$)/i,
    defensivePackage: /Defensive Package Was\s*:\s*(.*?)\s*Coverage/,
    coverage: /Coverage\s*:\s*(.*?)(?:;|$)/,
    roamerJob: /Roamer Job\s*-\s*(.*?)(?:;|$)/,
    blitzing: /Blitzing\s*:\s*(.*)/i,
    hole: /thru\s+([A-Z0-9]+)\s+hole/i,
    downfield: /<span[^>]*class="supza"[^>]*>(-?\d+)<\/span>.*?<span[^>]*class="supz"[^>]*>(\d+)<\/span>\s*yard\(s\)\s*downfield/i,
    passTargetFinal: /Pass by[\s\S]*?(?:to|DROPPED by)\s+([A-Za-z]{1,4}\d{1,2})/i,
    positionToken: /to\s+([A-Za-z]{1,4}\d{1,2})\s*(?:<a|\b)/i,
    positionTokens: /^[A-Z]{1,4}\d{0,2}$/,
    nbsp: /&nbsp;|&#160;/gi,
    tags: /<[^>]+>/g,
    whitespace: /\s+/g
};

// ============================================================================
// UI COMPONENTS
// ============================================================================

function injectDownloadButton() {
    // Create container for buttons
    const buttonContainer = document.createElement('div');
    buttonContainer.id = 'deeproute-parser-buttons';
    Object.assign(buttonContainer.style, {
        position: 'fixed',
        ...CONFIG.BUTTON_POSITION,
        zIndex: '10000',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px'
    });

    // Week button
    const weekButton = document.createElement('button');
    weekButton.textContent = 'Parse This Week';
    weekButton.id = 'deeproute-parser-week-btn';
    
    Object.assign(weekButton.style, {
        padding: '10px 20px',
        backgroundColor: CONFIG.COLORS.primary,
        color: 'white',
        border: 'none',
        borderRadius: '5px',
        cursor: 'pointer',
        boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '14px',
        fontWeight: '500',
        transition: 'background-color 0.2s ease'
    });

    weekButton.addEventListener('mouseover', () => {
        if (!weekButton.disabled) weekButton.style.backgroundColor = CONFIG.COLORS.hover;
    });
    
    weekButton.addEventListener('mouseout', () => {
        if (!weekButton.disabled) weekButton.style.backgroundColor = CONFIG.COLORS.primary;
    });
    
    weekButton.addEventListener('click', (e) => parseAndDownload(e, false));

    // Season button
    const seasonButton = document.createElement('button');
    seasonButton.textContent = 'Parse Regular Season';
    seasonButton.id = 'deeproute-parser-season-btn';
    
    Object.assign(seasonButton.style, {
        padding: '10px 20px',
        backgroundColor: '#2196F3',
        color: 'white',
        border: 'none',
        borderRadius: '5px',
        cursor: 'pointer',
        boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '14px',
        fontWeight: '500',
        transition: 'background-color 0.2s ease'
    });

    seasonButton.addEventListener('mouseover', () => {
        if (!seasonButton.disabled) seasonButton.style.backgroundColor = '#1976D2';
    });
    
    seasonButton.addEventListener('mouseout', () => {
        if (!seasonButton.disabled) seasonButton.style.backgroundColor = '#2196F3';
    });
    
    seasonButton.addEventListener('click', (e) => parseAndDownload(e, true));

    buttonContainer.appendChild(weekButton);
    buttonContainer.appendChild(seasonButton);
    document.body.appendChild(buttonContainer);
}

class ButtonController {
    constructor(button) {
        this.button = button;
        this.originalText = button ? button.textContent : '';
    }

    setProcessing(current, total) {
        if (!this.button) return;
        this.button.textContent = `Parsing ${current}/${total}`;
        this.button.disabled = true;
        this.button.style.backgroundColor = CONFIG.COLORS.disabled;
        this.button.style.cursor = 'wait';
    }

    setError(message) {
        if (!this.button) return;
        this.button.textContent = message;
        this.button.style.backgroundColor = CONFIG.COLORS.error;
        setTimeout(() => this.reset(), 3000);
    }

    reset() {
        if (!this.button) return;
        this.button.textContent = this.originalText;
        this.button.disabled = false;
        this.button.style.backgroundColor = CONFIG.COLORS.primary;
        this.button.style.cursor = 'pointer';
    }
}

// ============================================================================
// ASYNC FETCHING WITH CONCURRENCY CONTROL
// ============================================================================

class ConcurrentFetcher {
    constructor(maxConcurrent = CONFIG.MAX_CONCURRENT_REQUESTS) {
        this.maxConcurrent = maxConcurrent;
        this.running = 0;
        this.queue = [];
    }

    async fetch(url, timeoutMs = 15000) {
        while (this.running >= this.maxConcurrent) {
            await new Promise(resolve => this.queue.push(resolve));
        }

        this.running++;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch(url, { signal: controller.signal });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.text();
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error(`Request timed out after ${timeoutMs}ms: ${url}`);
            }
            throw error;
        } finally {
            clearTimeout(timeoutId);
            this.running--;
            if (this.queue.length > 0) {
                const resolve = this.queue.shift();
                resolve();
            }
        }
    }

    // Final attempt with a much longer timeout — used as last resort before giving up
    async fetchLastResort(url, timeoutMs = 60000) {
        return this.fetch(url, timeoutMs);
    }
}

// ============================================================================
// MAIN PARSING LOGIC
// ============================================================================

async function parseAndDownload(event, isFullSeason = false) {
    const button = event ? event.target : null;
    const btnController = new ButtonController(button);

    try {
        if (isFullSeason) {
            await parseFullSeason(btnController);
        } else {
            await parseSingleWeek(btnController);
        }
    } catch (error) {
        console.error('Fatal error during parsing:', error);
        btnController.setError('Error!');
        alert(`An error occurred: ${error.message}`);
    }
}

async function parseSingleWeek(btnController) {
        // Extract page metadata
        const urlParams = new URLSearchParams(window.location.search);
        const leagueNum = urlParams.get('myleagueno') || 'N/A';
        
        // Extract Year from the selected option element
        let year = 'N/A';
        const selectedOption = document.querySelector('option[selected][value*="year="]');
        if (selectedOption) {
            const match = selectedOption.getAttribute('value').match(PATTERNS.year);
            if (match) year = match[1];
        }

        // Determine Game Type and Week from score element ID
        let gameType = 'N/A';
        let week = 'N/A';
        const scoreElement = document.querySelector('[id^="scores-"]');
        if (scoreElement) {
            const idParts = scoreElement.id.split('-');
            if (idParts.length >= 3) {
                const typeChar = idParts[1];
                week = idParts[2];
                switch (typeChar) {
                    case 'X': gameType = 'pre'; break;
                    case 'P': gameType = 'post'; break;
                    case 'R':
                    default: gameType = 'reg'; break;
                }
            }
        }

        // Locate the matchup table
        const matchupTable = document.querySelector("#innertable > table > tbody > tr > td > div > table");
        if (!matchupTable || matchupTable.rows.length < 2) {
            alert("Could not find a valid weekly matchup table on this page.");
            return;
        }

        // Prepare CSV structure
        const newLogHeaders = ['"Quarter"', '"Time"', '"Down"', '"Distance"', '"Field Position"', '"Points Home"', '"Points Away"', '"Play Type"', '"Possession"', '"Off Team"', '"Def Team"', '"Offensive Package"', '"Off Subpackage"', '"Formation"', '"Off Play"', '"Def Package"', '"Coverage"', '"Coverage Depth"', '"Roamer Job"', '"Def Blitzer"', '"Total Yards"', '"Play Result"', '"Passer ID"', '"Runner"', '"Runner ID"', '"Hole"', '"First Read"', '"First Target"', '"First Target ID"', '"First In Coverage"', '"First In Coverage ID"', '"Second Read"', '"Second Target"', '"Second Target ID"', '"Second In Coverage"', '"Second In Coverage ID"', '"Third Read"', '"Third Target"', '"Third Target ID"', '"Third In Coverage"', '"Third In Coverage ID"', '"Fourth Read"', '"Fourth Target"', '"Fourth Target ID"', '"Fourth In Coverage"', '"Fourth In Coverage ID"', '"Final Target"', '"Final Target ID"', '"Final In Coverage"', '"Final In Coverage ID"', '"Target Distance"', '"Yards After Catch"', '"Tackler"', '"Tackler ID"', '"TFL Position"', '"TFL Position ID"', '"BD Position"', '"BD Position ID"', '"PD Position"', '"PD Position ID"', '"INT Position"', '"INT Position ID"', '"Sck Position"', '"Sck Position ID"', '"Sk Alwd Position"', '"Sk Alwd Position ID"', '"Pressure Type"', '"FF Position"', '"FF Position ID"', '"Cov Txt"', '"Cov Txt Pos"', '"Cov Txt ID"', '"Punt Dist"', '"Return Yds"', '"Returner ID"', '"off_pos1"', '"off_id1"', '"off_pos2"', '"off_id2"', '"off_pos3"', '"off_id3"', '"off_pos4"', '"off_id4"', '"off_pos5"', '"off_id5"', '"off_pos6"', '"off_id6"', '"off_pos7"', '"off_id7"', '"off_pos8"', '"off_id8"', '"off_pos9"', '"off_id9"', '"off_pos10"', '"off_id10"', '"off_pos11"', '"off_id11"', '"def_pos1"', '"def_id1"', '"def_pos2"', '"def_id2"', '"def_pos3"', '"def_id3"', '"def_pos4"', '"def_id4"', '"def_pos5"', '"def_id5"', '"def_pos6"', '"def_id6"', '"def_pos7"', '"def_id7"', '"def_pos8"', '"def_id8"', '"def_pos9"', '"def_id9"', '"def_pos10"', '"def_id10"', '"def_pos11"', '"def_id11"'];
        const csvHeader = ['"League"', '"Year"', '"Type"', '"Week"', ...newLogHeaders].join(',');
        const csvRows = [];

        // Set up fetcher with concurrency of 1 for sequential processing
        const fetcher = new ConcurrentFetcher(1);
        const totalGames = matchupTable.rows.length;

        btnController.setProcessing(0, totalGames);

        let completedGames = 0;
        let failedGames = 0;

        // Process games SEQUENTIALLY (one at a time) to avoid server rate limiting
        for (const [index, row] of Array.from(matchupTable.rows).entries()) {
            const gameNum = index + 1;
            let retries = 2;

            while (retries >= 0) {
                try {
                    let homeTeam = "N/A";
                    let awayTeam = "N/A";
                    const scoresSpan = row.querySelector('[id^="scores-"] span');
                    if (scoresSpan) {
                        const links = scoresSpan.querySelectorAll('a');
                        if (links.length >= 2) {
                            awayTeam = links[0].innerText.trim();
                            homeTeam = links[1].innerText.trim();
                        }
                    }

                    const logLink = row.querySelector('a[href*="?js=loggerinc&viewpbp="]');
                    if (!logLink) {
                        completedGames++;
                        btnController.setProcessing(completedGames, totalGames);
                        break;
                    }

                    // On the last retry, use a much longer timeout as a final attempt
                    const logPageHtml = retries === 0
                        ? await fetcher.fetchLastResort(logLink.href)
                        : await fetcher.fetch(logLink.href);

                    if (!logPageHtml || logPageHtml.length < 100) {
                        throw new Error('Empty or invalid response');
                    }

                    const parser = new DOMParser();
                    const logDoc = parser.parseFromString(logPageHtml, 'text/html');
                    const extractedRows = extractDataFromLogPage(logDoc, homeTeam, awayTeam);

                    completedGames++;
                    btnController.setProcessing(completedGames, totalGames);

                    csvRows.push(...extractedRows.map(playData => {
                        return [
                            `"${leagueNum}"`,
                            `"${year}"`,
                            `"${gameType}"`,
                            `"${week}"`,
                            ...playData
                        ].join(',');
                    }));

                    break; // Success - exit retry loop

                } catch (error) {
                    retries--;
                    if (retries < 0) {
                        console.error(`Failed to process game ${gameNum} after retries:`, error);
                        failedGames++;
                        completedGames++;
                        btnController.setProcessing(completedGames, totalGames);
                    } else {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                }
            }

            // Small delay between games to avoid server rate limiting
            await new Promise(resolve => setTimeout(resolve, 300));
        }

        // Warn user if some games failed
        if (failedGames > 0) {
            console.warn(`Warning: ${failedGames} game(s) failed to parse`);
            alert(`Parsing complete! Note: ${failedGames} of ${totalGames} games failed. Check console for details.`);
        }

        // Generate and download CSV
        const csvContent = [csvHeader, ...csvRows].join('\n');
        
        // Build filename with league, year, type, and week
        let filename = "deeproute";
        
        if (leagueNum && leagueNum !== 'N/A') {
            filename += `_lg${leagueNum}`;
        }
        
        if (year && year !== 'N/A') {
            filename += `_${year}`;
        }
        
        if (gameType && gameType !== 'N/A') {
            filename += `_${gameType}`;
        }
        
        if (week && week !== 'N/A') {
            filename += `_wk${week}`;
        }
        
        filename += ".csv";

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");

        if (link.download !== undefined) {
            const url = URL.createObjectURL(blob);
            link.setAttribute("href", url);
            link.setAttribute("download", filename);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url); // Clean up memory
        }

        btnController.reset();
}

async function parseFullSeason(btnController) {
    // Find all week links on the page
    const weekLinks = document.querySelectorAll('a[onclick*="showem"]');
    if (weekLinks.length === 0) {
        alert('Could not find week links. Please make sure you are on the schedule page.');
        return;
    }

    // Parse the onclick attributes to extract week information
    const allWeeks = [];
    weekLinks.forEach(link => {
        const onclick = link.getAttribute('onclick');
        const match = onclick.match(/showem\('([XRP])','(\d+)'\)/);
        if (match) {
            const typeChar = match[1];
            const weekNum = match[2];
            
            // Only include regular season games
            if (typeChar === 'R') {
                const typeMap = { 'X': 'pre', 'R': 'reg', 'P': 'post' };
                allWeeks.push({
                    type: typeMap[typeChar],
                    typeChar: typeChar,
                    week: weekNum,
                    link: link
                });
            }
        }
    });

    if (allWeeks.length === 0) {
        alert('No weeks found to parse.');
        return;
    }

    // Confirm with user
    if (!confirm(`This will parse ${allWeeks.length} regular season weeks. This may take several minutes. Continue?`)) {
        return;
    }

    btnController.setProcessing(0, allWeeks.length);

    // Extract current page info using the SAME method as single week parse
    const urlParams = new URLSearchParams(window.location.search);
    const leagueNum = urlParams.get('myleagueno') || 'N/A';
    
    // Extract Year from the selected option element (same as single week)
    let year = 'N/A';
    const selectedOption = document.querySelector('option[selected][value*="year="]');
    if (selectedOption) {
        const match = selectedOption.getAttribute('value').match(PATTERNS.year);
        if (match) year = match[1];
    }

    // Collect all data
    const allCsvRows = [];
    
    // Process each week
    for (let i = 0; i < allWeeks.length; i++) {
        const weekInfo = allWeeks[i];
        btnController.setProcessing(i + 1, allWeeks.length);

        try {
            // Call showem() to load this week's data
            // We need to trigger the same function the site uses
            if (weekInfo.link) {
                weekInfo.link.click();
            } else if (typeof showem === 'function') {
                showem(weekInfo.typeChar, weekInfo.week);
            }
            
            // Wait for the page to update (give it a moment to load)
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Now parse the currently displayed week
            const matchupTable = document.querySelector("#innertable > table > tbody > tr > td > div > table");
            if (!matchupTable || matchupTable.rows.length === 0) {
                console.warn(`No games found for ${weekInfo.type} week ${weekInfo.week}`);
                continue;
            }

            // Create a single fetcher with reduced concurrency for stability
            const fetcher = new ConcurrentFetcher(1); // Process one game at a time
            
            // Parse games SEQUENTIALLY (one at a time) instead of all at once
            const weekResults = [];
            for (const row of matchupTable.rows) {
                const logLink = row.querySelector('a[href*="?js=loggerinc&viewpbp="]');
                if (!logLink) continue;

                let homeTeam = "N/A";
                let awayTeam = "N/A";
                const scoresSpan = row.querySelector('[id^="scores-"] span');
                if (scoresSpan) {
                    const links = scoresSpan.querySelectorAll('a');
                    if (links.length >= 2) {
                        awayTeam = links[0].innerText.trim();
                        homeTeam = links[1].innerText.trim();
                    }
                }

                let logPageHtml = null;
                let retries = 2;
                while (retries >= 0) {
                    try {
                        // On the last retry, use a much longer timeout as a final attempt
                        logPageHtml = retries === 0
                            ? await fetcher.fetchLastResort(logLink.href)
                            : await fetcher.fetch(logLink.href);
                        break; // Success
                    } catch (error) {
                        retries--;
                        if (retries >= 0) {
                            await new Promise(resolve => setTimeout(resolve, 1000));
                        } else {
                            console.error(`Failed to fetch game in ${weekInfo.type} week ${weekInfo.week}:`, error);
                        }
                    }
                }

                if (!logPageHtml || logPageHtml.length < 100) {
                    await new Promise(resolve => setTimeout(resolve, 300));
                    continue;
                }

                try {
                    const logParser = new DOMParser();
                    const logDoc = logParser.parseFromString(logPageHtml, 'text/html');
                    const extractedRows = extractDataFromLogPage(logDoc, homeTeam, awayTeam);

                    // Add to results
                    const gameRows = extractedRows.map(playData => {
                        const finalRow = [
                            `"${leagueNum}"`,
                            `"${year}"`,
                            `"${weekInfo.type}"`,
                            `"${weekInfo.week}"`,
                            ...playData
                        ];
                        return finalRow.join(',');
                    });
                    
                    weekResults.push(...gameRows);
                } catch (error) {
                    console.error(`Error in ${weekInfo.type} week ${weekInfo.week} game:`, error);
                }
                
                // Small delay between games to avoid server rate limiting
                await new Promise(resolve => setTimeout(resolve, 300));
            }

            allCsvRows.push(...weekResults);

        } catch (error) {
            console.error(`Error processing ${weekInfo.type} week ${weekInfo.week}:`, error);
        }
    }

    // Build CSV header
    const newLogHeaders = ['"Quarter"', '"Time"', '"Down"', '"Distance"', '"Field Position"', '"Points Home"', '"Points Away"', '"Play Type"', '"Possession"', '"Off Team"', '"Def Team"', '"Offensive Package"', '"Off Subpackage"', '"Formation"', '"Off Play"', '"Def Package"', '"Coverage"', '"Coverage Depth"', '"Roamer Job"', '"Def Blitzer"', '"Total Yards"', '"Play Result"', '"Passer ID"', '"Runner"', '"Runner ID"', '"Hole"', '"First Read"', '"First Target"', '"First Target ID"', '"First In Coverage"', '"First In Coverage ID"', '"Second Read"', '"Second Target"', '"Second Target ID"', '"Second In Coverage"', '"Second In Coverage ID"', '"Third Read"', '"Third Target"', '"Third Target ID"', '"Third In Coverage"', '"Third In Coverage ID"', '"Fourth Read"', '"Fourth Target"', '"Fourth Target ID"', '"Fourth In Coverage"', '"Fourth In Coverage ID"', '"Final Target"', '"Final Target ID"', '"Final In Coverage"', '"Final In Coverage ID"', '"Target Distance"', '"Yards After Catch"', '"Tackler"', '"Tackler ID"', '"TFL Position"', '"TFL Position ID"', '"BD Position"', '"BD Position ID"', '"PD Position"', '"PD Position ID"', '"INT Position"', '"INT Position ID"', '"Sck Position"', '"Sck Position ID"', '"Sk Alwd Position"', '"Sk Alwd Position ID"', '"Pressure Type"', '"FF Position"', '"FF Position ID"', '"Cov Txt"', '"Cov Txt Pos"', '"Cov Txt ID"', '"Punt Dist"', '"Return Yds"', '"Returner ID"', '"off_pos1"', '"off_id1"', '"off_pos2"', '"off_id2"', '"off_pos3"', '"off_id3"', '"off_pos4"', '"off_id4"', '"off_pos5"', '"off_id5"', '"off_pos6"', '"off_id6"', '"off_pos7"', '"off_id7"', '"off_pos8"', '"off_id8"', '"off_pos9"', '"off_id9"', '"off_pos10"', '"off_id10"', '"off_pos11"', '"off_id11"', '"def_pos1"', '"def_id1"', '"def_pos2"', '"def_id2"', '"def_pos3"', '"def_id3"', '"def_pos4"', '"def_id4"', '"def_pos5"', '"def_id5"', '"def_pos6"', '"def_id6"', '"def_pos7"', '"def_id7"', '"def_pos8"', '"def_id8"', '"def_pos9"', '"def_id9"', '"def_pos10"', '"def_id10"', '"def_pos11"', '"def_id11"'];
    const csvHeader = ['"League"', '"Year"', '"Type"', '"Week"', ...newLogHeaders].join(',');

    // Rows are already formatted as CSV strings, just join them
    const csvContent = [csvHeader, ...allCsvRows].join('\n');

    // Download
    let filename = "deeproute";
    if (leagueNum && leagueNum !== 'N/A') filename += `_lg${leagueNum}`;
    if (year && year !== 'N/A') filename += `_${year}`;
    filename += "_fullseason.csv";

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    btnController.reset();
    alert(`Full season parsed! Total plays: ${allCsvRows.length}`);
}

// ============================================================================
// LOG PAGE DATA EXTRACTION (PRESERVES ORIGINAL LOGIC)
// ============================================================================

function extractDataFromLogPage(logDoc, homeTeam, awayTeam) {
    const rows = [];

    // Extract Team Abbreviations (ORIGINAL SELECTORS)
    let homeAbbrev = "N/A";
    let awayAbbrev = "N/A";
    const homeAbbrevEl = logDoc.querySelector("#hscore > tbody > tr > th");
    if (homeAbbrevEl) homeAbbrev = homeAbbrevEl.textContent.trim();
    const awayAbbrevEl = logDoc.querySelector("#vscore > tbody > tr > th");
    if (awayAbbrevEl) awayAbbrev = awayAbbrevEl.textContent.trim();

    // Find the play-by-play table (ORIGINAL SELECTOR)
    const table = logDoc.querySelector("#blah > center > table > tbody > tr > td > table > tbody");
    
    if (!table) return rows;

    let currentPlay = null;
    let currentPlayColor = null;
    let homeScore = 0;
    let awayScore = 0;
    let lastQuarter = "Q1";
    let lastTime = "15:00";
    let nextOffPos1 = "";
    let nextOffId1 = "";
    let nextOffPos2 = "";
    let nextOffId2 = "";
    let nextOffPos3 = "";
    let nextOffId3 = "";
    let nextOffPos4 = "";
    let nextOffId4 = "";
    let nextOffPos5 = "";
    let nextOffId5 = "";
    let nextOffPos6 = "";
    let nextOffId6 = "";
    let nextOffPos7 = "";
    let nextOffId7 = "";
    let nextOffPos8 = "";
    let nextOffId8 = "";
    let nextOffPos9 = "";
    let nextOffId9 = "";
    let nextOffPos10 = "";
    let nextOffId10 = "";
    let nextOffPos11 = "";
    let nextOffId11 = "";
    let nextDefPos1 = "";
    let nextDefId1 = "";
    let nextDefPos2 = "";
    let nextDefId2 = "";
    let nextDefPos3 = "";
    let nextDefId3 = "";
    let nextDefPos4 = "";
    let nextDefId4 = "";
    let nextDefPos5 = "";
    let nextDefId5 = "";
    let nextDefPos6 = "";
    let nextDefId6 = "";
    let nextDefPos7 = "";
    let nextDefId7 = "";
    let nextDefPos8 = "";
    let nextDefId8 = "";
    let nextDefPos9 = "";
    let nextDefId9 = "";
    let nextDefPos10 = "";
    let nextDefId10 = "";
    let nextDefPos11 = "";
    let nextDefId11 = "";

    for (let i = 0; i < table.rows.length; i++) {
        const row = table.rows[i];
        const text = row.textContent.trim();
        const lowerText = text.toLowerCase();

        // Extract Play Result (ORIGINAL LOGIC)
        let playResult = "";
        if (lowerText.includes("touchdown")) {
            if (lowerText.includes("returned")) {
                playResult = "TD";
            } else if (lowerText.includes("pass") || lowerText.includes("complete") || lowerText.includes("threw")) {
                playResult = "complete, TD";
            } else if (lowerText.includes("handoff") || lowerText.includes("scramble") || lowerText.includes("rush")) {
                playResult = "rush; TD";
            } else {
                playResult = "TD";
            }
        } else if (lowerText.includes("batted down by")) {
            playResult = "batted pass";
        } else if (lowerText.includes("pass defended")) {
            playResult = "pass defended";
        } else if (lowerText.includes("intercepted") || lowerText.includes("interception")) {
            playResult = "interception";
        } else if (lowerText.includes("fumble")) {
            playResult = "fumble";
        } else if (lowerText.includes("threw the ball away")) {
            playResult = "throw away";
        } else if (lowerText.includes("incomplete")) {
            playResult = "incomplete";
        } else if (lowerText.includes("dropped")) {
            playResult = "drop";
        } else if (lowerText.includes("dump it off")) {
            playResult = "dump off";
        } else if (lowerText.includes("complete")) {
            playResult = "complete";
        } else if (lowerText.includes("sacked")) {
            playResult = "sack";
        } else if (lowerText.includes("scrambles")) {
            playResult = "scramble";
        } else if (lowerText.includes("handoff")) {
            playResult = "rush";
        } else if (lowerText.includes("fair catch") || lowerText.includes("no return")) {
            playResult = "fair catch";
        } else if (lowerText.includes("touchback")) {
            playResult = "touchback";
        } else if (lowerText.includes("away is good")) {
            playResult = "good";
        } else if (lowerText.includes("is no good")) {
            playResult = "no good";
        } else if (lowerText.includes("penalty")) {
            playResult = "penalty";
        } else if (lowerText.includes("time out")) {
            playResult = "timeout";
        } else if (lowerText.includes("returned")) {
            playResult = "return";
        }

        // Extract Passer ID (ORIGINAL LOGIC)
        let passerId = "";
        if (lowerText.includes("pass by")) {
            const html = row.innerHTML;
            const passMatch = html.match(PATTERNS.passBy);
            if (passMatch) {
                passerId = passMatch[1];
            }
        } else if (lowerText.includes("threw the ball away")) {
            const html = row.innerHTML;
            const throwAwayMatch = html.match(/QB\s+<a[^>]*lookatplayer=(\d+)/i);
            if (throwAwayMatch) {
                passerId = throwAwayMatch[1];
            }
        } else if (lowerText.includes("amazing catch")) {
            // "AMAZING catch by WR1 ... on the pass from QB <a...lookatplayer=ID>"
            const html = row.innerHTML;
            const amazingPasserMatch = html.match(/on the pass from QB\s+<a[^>]*lookatplayer=(\d+)/i);
            if (amazingPasserMatch) {
                passerId = amazingPasserMatch[1];
            }
        }

        // Extract Runner (ORIGINAL LOGIC)
        let runner = "";
        const handoffMatch = text.match(PATTERNS.handoff);
        if (handoffMatch) {
            runner = handoffMatch[1];
        } else {
            const snapMatch = text.match(PATTERNS.snap);
            if (snapMatch) {
                runner = snapMatch[1];
            }
        }

        // Extract Runner ID (ORIGINAL LOGIC)
        let runnerId = "";
        if (lowerText.includes("handoff to")) {
            const html = row.innerHTML;
            const runnerIdMatch = html.match(PATTERNS.handoffId);
            if (runnerIdMatch) {
                runnerId = runnerIdMatch[1];
            }
        } else if (lowerText.includes("scrambles")) {
            // On a scramble the QB is the runner - extract the QB's lookatplayer ID
            const html = row.innerHTML;
            const scrambleIdMatch = html.match(/QB\s+<a[^>]*lookatplayer=(\d+)/i);
            if (scrambleIdMatch) {
                runnerId = scrambleIdMatch[1];
            }
        }

        // 9. Extract Tackler
        let tackler = "";
        let tacklerId = "";
        if (lowerText.includes("before being tackled by")) {
            const tacklerMatch = row.innerHTML.match(/before being tackled by\s+([A-Z0-9]+)\s+<a[^>]*lookatplayer=(\d+)/i);
            if (tacklerMatch) {
                tackler = tacklerMatch[1];
                tacklerId = tacklerMatch[2];
            }
        }

        // 10. Extract Pass Defended
        let pdPosition = "";
        let pdPositionId = "";
        if (lowerText.includes("with a pass defended")) {
            const pdMatch = row.innerHTML.match(/credit\s+([A-Z0-9]+)\s+<a[^>]*lookatplayer=(\d+)[^>]*>.*?with a pass defended/i);
            if (pdMatch) {
                pdPosition = pdMatch[1];
                pdPositionId = pdMatch[2];
            }
        }

        // 11. Extract Interception
        let intPosition = "";
        let intPositionId = "";
        if (lowerText.includes("intercepted by")) {
            const intMatch = row.innerHTML.match(/INTERCEPTED by\s+([A-Z0-9]+)\s+<a[^>]*lookatplayer=(\d+)/i);
            if (intMatch) {
                intPosition = intMatch[1];
                intPositionId = intMatch[2];
            }
        }

        // 12. Extract TFL
        let tflPosition = "";
        let tflPositionId = "";
        if (lowerText.includes("stopped in the backfield by")) {
            const tflMatch = row.innerHTML.match(/stopped in the backfield by\s+([A-Z0-9]+)\s+<a[^>]*lookatplayer=(\d+)/i);
            if (tflMatch) {
                tflPosition = tflMatch[1];
                tflPositionId = tflMatch[2];
            }
        }

        // 13. Extract Batted Down
        let bdPosition = "";
        let bdPositionId = "";
        if (lowerText.includes("batted down by")) {
            const bdMatch = row.innerHTML.match(/batted down by\s+([A-Z0-9]+)\s+<a[^>]*lookatplayer=(\d+)/i);
            if (bdMatch) {
                bdPosition = bdMatch[1];
                bdPositionId = bdMatch[2];
            }
        }

        // 14. Extract Sack
        let sckPosition = "";
        let sckPositionId = "";
        // Normalize HTML to handle &nbsp; and newlines for regex matching. 
        // We use this cleaned string for both Sack and Sack Allowed extractions.
        const cleanHtml = row.innerHTML.replace(PATTERNS.nbsp, ' ').replace(/\s+/g, ' ');

        if (lowerText.includes("sacked")) {
            // Capture any text between "by" and the player link
            // We use a non-greedy match (.*?) to get everything up to the link
            const sckMatch = cleanHtml.match(/SACKED.*?by\s*(.*?)\s*<a[^>]*lookatplayer=(\d+)/i);
            if (sckMatch) {
                // Remove any HTML tags from the captured position text
                sckPosition = sckMatch[1].replace(/<[^>]+>/g, '').trim();
                sckPositionId = sckMatch[2];
            }
        }

        // 15. Extract Sack Allowed
        let skAlwdPosition = "";
        let skAlwdPositionId = "";
        if (lowerText.includes("allowing the sack")) {
            // Capture the position (allowing dots/dashes) immediately preceding the player link that is closest to "allowing the sack"
            // Make the position group optional (?:...)? so we capture the ID even if position is missing
            const skAlwdMatch = cleanHtml.match(/(?:([A-Z0-9\.-]+)(?:<[^>]+>|\s)*)?<a[^>]*lookatplayer=(\d+)[^>]*>(?:(?!<a).)*?(?:is responsible for|is charged with).*?allowing the sack/i);
            if (skAlwdMatch) {
                skAlwdPosition = (skAlwdMatch[1] || "").trim();
                skAlwdPositionId = skAlwdMatch[2];
            }
        }

        // 16. Extract Forced Fumble
        let ffPosition = "";
        let ffPositionId = "";
        if (lowerText.includes("fumble")) {
            if (tackler) {
                ffPosition = tackler;
                ffPositionId = tacklerId;
            } else if (currentPlay && currentPlay[52] !== '""') {
                ffPosition = currentPlay[52].replace(/"/g, '');
                ffPositionId = currentPlay[53].replace(/"/g, '');
            }
        }

        // 17. Extract Coverage Text
        let covTxt = "";
        let covTxtPos = "";
        let covTxtId = "";
        // Case 1: "...is right there as..."
        const covTxtRightThereMatch = row.innerHTML.match(/([A-Z0-9]+)\s+<a[^>]*lookatplayer=(\d+)[^>]*>.*?<\/a>\s+is\s+(right there)\s+as\s+[A-Z0-9]+\s*<a/i);
        if (covTxtRightThereMatch) {
            covTxtPos = covTxtRightThereMatch[1].trim();
            covTxtId = covTxtRightThereMatch[2];
            covTxt = covTxtRightThereMatch[3].trim();
        } else {
            // Case 2: "Tight coverage by [POSITION] [PLAYER]"
            const covTxtTightCoverageMatch = row.innerHTML.match(/(\bTight coverage)\s+by\s+([A-Z0-9]+)\s+<a[^>]*lookatplayer=(\d+)/i);
            if (covTxtTightCoverageMatch) {
                covTxt = covTxtTightCoverageMatch[1].trim();
                covTxtPos = covTxtTightCoverageMatch[2].trim();
                covTxtId = covTxtTightCoverageMatch[3];
            } else {
                // Case 3: "...but [POSITION] [PLAYER] is closing in"
                const covTxtClosingInMatch = row.innerHTML.match(/but\s+([A-Z0-9]+)\s+<a[^>]*lookatplayer=(\d+)[^>]*>.*?<\/a>\s+is\s+(closing in)/i);
                if (covTxtClosingInMatch) {
                    covTxtPos = covTxtClosingInMatch[1].trim();
                    covTxtId = covTxtClosingInMatch[2];
                    covTxt = covTxtClosingInMatch[3].trim();
                } else {
                    // Case 4: "...with [POSITION] [PLAYER] closing in fast"
                    const covTxtClosingInFastMatch = row.innerHTML.match(/with\s+([A-Z0-9]+)\s+<a[^>]*lookatplayer=(\d+)[^>]*>.*?<\/a>\s+(closing in fast)/i);
                    if (covTxtClosingInFastMatch) {
                        covTxtPos = covTxtClosingInFastMatch[1].trim();
                        covTxtId = covTxtClosingInFastMatch[2];
                        covTxt = covTxtClosingInFastMatch[3].trim();
                    } else {
                        // Case 5: "...space between him and [POSITION] [PLAYER]"
                        const covTxtSpaceBetweenMatch = row.innerHTML.match(/with some (space between) him and ([A-Z0-9]+)\s+<a[^>]*lookatplayer=(\d+)/i);
                        if (covTxtSpaceBetweenMatch) {
                            covTxt = covTxtSpaceBetweenMatch[1].trim();
                            covTxtPos = covTxtSpaceBetweenMatch[2].trim();
                            covTxtId = covTxtSpaceBetweenMatch[3];
                        } else {
                            // Case 6: "[POSITION] [PLAYER] is in perfect position... after the catch"
                            const covTxtPerfectPositionMatch = row.innerHTML.match(/([A-Z0-9]+)\s+<a[^>]*lookatplayer=(\d+)[^>]*>.*?<\/a>\s+is in (perfect position).*?after the catch/i);
                            if (covTxtPerfectPositionMatch) {
                                covTxtPos = covTxtPerfectPositionMatch[1].trim();
                                covTxtId = covTxtPerfectPositionMatch[2];
                                covTxt = "perfect position after catch";
                            }
                        }
                    }
                }
            }
        }

        // 18. Extract Punt Distance
        let puntDist = "";
        if (lowerText.includes("punt by")) {
            const puntDistMatch = row.innerHTML.match(/for\s+<span[^>]*class="supza"[^>]*>(\d+)<\/span>.*?<span[^>]*class="supz"[^>]*>(\d+)<\/span>\s*yards/i);
            if (puntDistMatch) {
                puntDist = puntDistMatch[1] + "." + puntDistMatch[2];
            } else {
                const underscoreMatch = text.match(/for\s+(\d+)\s+__(\d+)__\s*yards/i);
                if (underscoreMatch) {
                    puntDist = underscoreMatch[1] + "." + underscoreMatch[2];
                }
            }
        }

        // 19. Extract Returner Info
        let returnYds = "";
        let returnerId = "";
        if (lowerText.includes("returned by")) {
            const returnerMatch = row.innerHTML.match(/returned by\s+<a[^>]*lookatplayer=(\d+)/i);
            if (returnerMatch) {
                returnerId = returnerMatch[1];
            }

            const returnYdsMatch = row.innerHTML.match(/<span[^>]*class="supza"[^>]*>(\d+)<\/span>.*?<span[^>]*class="supz"[^>]*>(\d+)<\/span>\s*yards/i);
            if (returnYdsMatch) {
                returnYds = returnYdsMatch[1] + "." + returnYdsMatch[2];
            } else {
                const underscoreMatch = text.match(/(\d+)\s+__(\d+)__\s*yards/i);
                if (underscoreMatch) {
                    returnYds = underscoreMatch[1] + "." + underscoreMatch[2];
                }
            }
        }

        // Check for separator line (ORIGINAL LOGIC)
        const isSeparator = row.querySelector('td[bgcolor="#000000"], td[bgcolor="#eeee99"], td[bgcolor="#EEEE99"]') !== null || text.includes("Offensive Players:") || text.includes("Offensive Players :") || text.includes("Defensive Players:") || text.includes("Defensive Players :");
        
        if (isSeparator) {
            if (currentPlay) {
                // Only keep Total Yards if there is an Offensive Package
                if (currentPlay[11] === '""') { // Off Package
                    currentPlay[20] = '""'; // Total Yards
                }
                rows.push(currentPlay);
            }
            currentPlay = null;
            currentPlayColor = null;

            // Extract off_pos1 from Offensive Players row
            if (text.includes("Offensive Players")) {
                let allPlayers = [];
                // Parse players from the first row (skill positions)
                const playersContentMatch = row.innerHTML.match(/Offensive Players\s*:\s*<\/b>\s*<br>(.*)/i);
                if (playersContentMatch) {
                    const playersString = playersContentMatch[1];
                    const skillPlayers = Array.from(playersString.matchAll(/\s*([A-Za-z0-9]+)\s*<a[^>]*?lookatplayer=(\d+)/gi));
                    allPlayers.push(...skillPlayers);
                }

                // Check for the next row (offensive line)
                const nextRow = table.rows[i + 1];
                if (nextRow) {
                    const nextRowText = nextRow.textContent.trim();
                    const hasTimestamp = nextRowText.match(PATTERNS.quarterTime);
                    const isContinuation = nextRowText.includes("Offensive Call :");
                    if (!hasTimestamp && !isContinuation) {
                        const linemen = Array.from(nextRow.innerHTML.matchAll(/\s*([A-Za-z0-9]+)\s*<a[^>]*?lookatplayer=(\d+)/gi));
                        allPlayers.push(...linemen);
                    }
                }

                // Assign to variables from the combined allPlayers array
                if (allPlayers.length > 0) { nextOffPos1 = allPlayers[0][1]; nextOffId1 = allPlayers[0][2]; }
                if (allPlayers.length > 1) { nextOffPos2 = allPlayers[1][1]; nextOffId2 = allPlayers[1][2]; }
                if (allPlayers.length > 2) { nextOffPos3 = allPlayers[2][1]; nextOffId3 = allPlayers[2][2]; }
                if (allPlayers.length > 3) { nextOffPos4 = allPlayers[3][1]; nextOffId4 = allPlayers[3][2]; }
                if (allPlayers.length > 4) { nextOffPos5 = allPlayers[4][1]; nextOffId5 = allPlayers[4][2]; }
                if (allPlayers.length > 5) { nextOffPos6 = allPlayers[5][1]; nextOffId6 = allPlayers[5][2]; }
                if (allPlayers.length > 6) { nextOffPos7 = allPlayers[6][1]; nextOffId7 = allPlayers[6][2]; }
                if (allPlayers.length > 7) { nextOffPos8 = allPlayers[7][1]; nextOffId8 = allPlayers[7][2]; }
                if (allPlayers.length > 8) { nextOffPos9 = allPlayers[8][1]; nextOffId9 = allPlayers[8][2]; }
                if (allPlayers.length > 9) { nextOffPos10 = allPlayers[9][1]; nextOffId10 = allPlayers[9][2]; }
                if (allPlayers.length > 10) { nextOffPos11 = allPlayers[10][1]; nextOffId11 = allPlayers[10][2]; }
            }

            // Extract def_pos1 from Defensive Players row
            if (text.includes("Defensive Players")) {
                let allDefPlayers = [];
                // Parse players from the first row
                const defPlayersContentMatch = row.innerHTML.match(/Defensive Players\s*:\s*<\/b>\s*<br>(.*)/i);
                if (defPlayersContentMatch) {
                    const defPlayersString = defPlayersContentMatch[1];
                    const defPlayers = Array.from(defPlayersString.matchAll(/\s*([A-Za-z0-9]+)\s*<a[^>]*?lookatplayer=(\d+)/gi));
                    allDefPlayers.push(...defPlayers);
                }

                // Check for the next row (continuation)
                const nextRow = table.rows[i + 1];
                if (nextRow) {
                    const nextRowText = nextRow.textContent.trim();
                    const hasTimestamp = nextRowText.match(PATTERNS.quarterTime);
                    const isContinuation = nextRowText.includes("Offensive Call :");
                    if (!hasTimestamp && !isContinuation && !nextRowText.includes("Defensive Players") && !nextRowText.includes("Offensive Players")) {
                        const defRow2 = Array.from(nextRow.innerHTML.matchAll(/\s*([A-Za-z0-9]+)\s*<a[^>]*?lookatplayer=(\d+)/gi));
                        allDefPlayers.push(...defRow2);
                    }
                }

                if (allDefPlayers.length > 0) { nextDefPos1 = allDefPlayers[0][1]; nextDefId1 = allDefPlayers[0][2]; }
                if (allDefPlayers.length > 1) { nextDefPos2 = allDefPlayers[1][1]; nextDefId2 = allDefPlayers[1][2]; }
                if (allDefPlayers.length > 2) { nextDefPos3 = allDefPlayers[2][1]; nextDefId3 = allDefPlayers[2][2]; }
                if (allDefPlayers.length > 3) { nextDefPos4 = allDefPlayers[3][1]; nextDefId4 = allDefPlayers[3][2]; }
                if (allDefPlayers.length > 4) { nextDefPos5 = allDefPlayers[4][1]; nextDefId5 = allDefPlayers[4][2]; }
                if (allDefPlayers.length > 5) { nextDefPos6 = allDefPlayers[5][1]; nextDefId6 = allDefPlayers[5][2]; }
                if (allDefPlayers.length > 6) { nextDefPos7 = allDefPlayers[6][1]; nextDefId7 = allDefPlayers[6][2]; }
                if (allDefPlayers.length > 7) { nextDefPos8 = allDefPlayers[7][1]; nextDefId8 = allDefPlayers[7][2]; }
                if (allDefPlayers.length > 8) { nextDefPos9 = allDefPlayers[8][1]; nextDefId9 = allDefPlayers[8][2]; }
                if (allDefPlayers.length > 9) { nextDefPos10 = allDefPlayers[9][1]; nextDefId10 = allDefPlayers[9][2]; }
                if (allDefPlayers.length > 10) { nextDefPos11 = allDefPlayers[10][1]; nextDefId11 = allDefPlayers[10][2]; }
            }

            // Check for Score Update in this separator row (ORIGINAL LOGIC)
            const scoreMatch = text.match(PATTERNS.scoreUpdate);
            if (scoreMatch) {
                const team1 = scoreMatch[1].trim();
                const score1 = parseInt(scoreMatch[2], 10);
                const team2 = scoreMatch[3].trim();
                const score2 = parseInt(scoreMatch[4], 10);

                if (team1 === homeTeam || homeTeam.includes(team1) || team1.includes(homeTeam)) {
                    homeScore = score1;
                } else if (team2 === homeTeam || homeTeam.includes(team2) || team2.includes(homeTeam)) {
                    homeScore = score2;
                }

                if (team1 === awayTeam || awayTeam.includes(team1) || team1.includes(awayTeam)) {
                    awayScore = score1;
                } else if (team2 === awayTeam || awayTeam.includes(team2) || team2.includes(awayTeam)) {
                    awayScore = score2;
                }
            }

            // Check for End of Half to reset time for Q3 Kickoff (ORIGINAL LOGIC)
            if (text.toLowerCase().includes("end of the second quarter")) {
                lastQuarter = "Q3";
                lastTime = "15:00";
            }
          
            continue;
        }

        // Check for possession change via color (ORIGINAL LOGIC)
        const firstCell = row.cells[0];
        const rowColor = firstCell ? firstCell.getAttribute('bgcolor') : null;

        if (currentPlay && currentPlayColor && rowColor) {
            const c1 = currentPlayColor.toLowerCase();
            const c2 = rowColor.toLowerCase();
            // If color changes between the two team colors (#eeffee <-> #eeeeff)
            if ((c1 === '#eeffee' || c1 === '#eeeeff') && 
                (c2 === '#eeffee' || c2 === '#eeeeff') && 
                c1 !== c2) {
                // If it's a punt, the color change implies possession change during the return (same play)
                if (currentPlay[7] === '"punt"' || currentPlay[7] === '"kickoff"') {
                    currentPlayColor = rowColor;
                } else {
                    rows.push(currentPlay);
                    currentPlay = null;
                    currentPlayColor = null;
                }
            }
        }
      
        // Look for Quarter pattern (e.g., "Q1 14:53") - NEW PLAY (ORIGINAL LOGIC)
        const match = text.match(PATTERNS.quarterTime);
        if (match && !text.includes("Offensive Call :")) {
            // Note: "Offensive Call :" rows contain timestamps but are not new plays
            // They'll be processed as continuation rows below and contain package info

            // Special case: Two Minute Warning should not create a new play
            // It should be treated as a continuation of the current play
            if (lowerText.includes("two minute warning")) {
                // Don't create a new play, just continue to next row
                continue;
            }
            
            const quarter = match[1];
            const time = match[2];
            lastQuarter = quarter;
            lastTime = time;

            // Extract Down (ORIGINAL LOGIC)
            const downMatch = text.match(PATTERNS.down);
            const down = downMatch ? downMatch[1] : "";

            // Extract Distance (ORIGINAL LOGIC)
            const distMatch = text.match(PATTERNS.distance);
            const distance = distMatch ? distMatch[1] : "";

            // Extract Field Position (ORIGINAL LOGIC)
            const fieldPosMatch = text.match(PATTERNS.fieldPos);
            let fieldPos = fieldPosMatch ? fieldPosMatch[1] : "";
            fieldPos = fieldPos.replace(/Own\s+/, "-").replace(/Opp\s+/, "+").replace(/Midfield/, "50");

            // Extract First Read (ORIGINAL LOGIC)
            let firstRead = "";
            if (lowerText.includes("primary option")) {
                firstRead = "covered";
            } else if (lowerText.includes("considers throwing to")) {
                if (lowerText.includes("doesn't look open")) {
                    firstRead = "covered";
                } else {
                    firstRead = "open";
                }
            }
            if (lowerText.includes("pass by") || lowerText.includes("amazing catch")) {
                if (firstRead !== "covered") firstRead = "open";
            }

            // Extract First Target (Moved up for dependency in Second Read)
            let firstTarget = "";
            let firstTargetId = "";
            const primaryOptionMatch = text.match(PATTERNS.primaryOption);
            if (primaryOptionMatch) {
                firstTarget = primaryOptionMatch[1];
            } else {
                const considersMatch = text.match(/considers throwing to\s+([A-Z0-9]+)/i);
                if (considersMatch) {
                    firstTarget = considersMatch[1];
                } else {
                    const passTargetMatch = text.match(PATTERNS.passTarget);
                    if (passTargetMatch) {
                        firstTarget = passTargetMatch[1];
                    } else {
                        const amazingMatch = text.match(PATTERNS.amazingCatch);
                        if (amazingMatch) firstTarget = amazingMatch[1];
                    }
                }
            }

            // Extract First Target ID from the link
            // Note: no playType check needed - "primary option" always implies a pass,
            // and playType may not be known yet on this continuation row
            if (firstTarget) {
                const html = row.innerHTML;
                const escapedTarget = firstTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                // Try "primary option was [POSITION] <a" pattern first
                const targetIdMatch = html.match(new RegExp(`primary option was\\s+${escapedTarget}\\s+<a[^>]*lookatplayer=(\\d+)`, 'i'));
                if (targetIdMatch) {
                    firstTargetId = targetIdMatch[1];
                } else {
                    // Try "considers throwing to [POSITION] <a" pattern
                    const considersIdMatch = html.match(new RegExp(`considers throwing to\\s+${escapedTarget}\\s+<a[^>]*lookatplayer=(\\d+)`, 'i'));
                    if (considersIdMatch) {
                        firstTargetId = considersIdMatch[1];
                    } else {
                        // Try "DROPPED by [POSITION] <a" pattern
                        const droppedMatch = html.match(new RegExp(`DROPPED by\\s+${escapedTarget}\\s+<a[^>]*lookatplayer=(\\d+)`, 'i'));
                        if (droppedMatch) {
                            firstTargetId = droppedMatch[1];
                        } else {
                            // Try "AMAZING catch by [POSITION] <a" pattern
                            const amazingMatch = html.match(new RegExp(`AMAZING catch by\\s+${escapedTarget}\\s+<a[^>]*lookatplayer=(\\d+)`, 'i'));
                            if (amazingMatch) {
                                firstTargetId = amazingMatch[1];
                            } else {
                                // Try "to [POSITION] <a" pattern
                                const toMatch = html.match(new RegExp(`to\\s+${escapedTarget}\\s+<a[^>]*lookatplayer=(\\d+)`, 'i'));
                                if (toMatch) {
                                    firstTargetId = toMatch[1];
                                } else {
                                    // Universal fallback: find the position token anywhere in the HTML
                                    // and grab the immediately following lookatplayer link
                                    const universalMatch = html.match(new RegExp(`\\b${escapedTarget}\\s+<a[^>]*lookatplayer=(\\d+)`, 'i'));
                                    if (universalMatch) {
                                        firstTargetId = universalMatch[1];
                                    } else {
                                        // Last resort: broad match after any known keyword
                                        const broadMatch = html.match(new RegExp(`(?:primary option was|considers throwing to|DROPPED by|AMAZING catch by|to)\\s+${escapedTarget}.*?lookatplayer=(\\d+)`, 'i'));
                                        if (broadMatch) {
                                            firstTargetId = broadMatch[1];
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // ========================================================================
            // CASCADING READ EXTRACTION (Second, Third, Fourth)
            // ========================================================================
            
            // 1. Determine Effective Previous State (combine currentPlay data with local extraction)
            // FIX: Prioritize currentPlay data to ensure we don't shadow established facts with local misinterpretations
            const cpFirstRead = currentPlay ? currentPlay[26].replace(/"/g, '') : "";
            const cpFirstTarget = currentPlay ? currentPlay[27].replace(/"/g, '') : "";
            const effectiveFirstRead = cpFirstRead || firstRead;
            const effectiveFirstTarget = cpFirstTarget || firstTarget;
            
            const cpSecondRead = currentPlay ? currentPlay[31].replace(/"/g, '') : "";
            const cpSecondTarget = currentPlay ? currentPlay[32].replace(/"/g, '') : "";
            
            const cpThirdRead = currentPlay ? currentPlay[36].replace(/"/g, '') : "";
            const cpThirdTarget = currentPlay ? currentPlay[37].replace(/"/g, '') : "";

            const cpFourthTarget = currentPlay ? currentPlay[42].replace(/"/g, '') : "";
            
            // Helper to extract ID for a specific target name from the current row's HTML
            const getTargetId = (tName, htmlContent) => {
                if (!tName) return "";
                const esc = tName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                // Try specific "considers throwing to X <a...>" pattern
                const m1 = htmlContent.match(new RegExp(`considers throwing to\\s+${esc}\\s+<a[^>]*lookatplayer=(\\d+)`, 'i'));
                if (m1) return m1[1];
                // Fallback to broad match
                const m2 = htmlContent.match(new RegExp(`considers throwing to\\s+${esc}.*?lookatplayer=(\\d+)`, 'i'));
                return m2 ? m2[1] : "";
            };

            // 2. Extract Second Read
            let secondRead = "";
            let secondTarget = "";
            let secondTargetId = "";
            
            if (effectiveFirstRead === "covered" && lowerText.includes("considers throwing to")) {
                // Only extract if we don't already have a Second Target (or to update status)
                if (!cpSecondTarget) {
                    const matches = Array.from(text.matchAll(/considers throwing to\s+([A-Z]{1,4}\d{0,2})/gi));
                    for (const m of matches) {
                        // Must not be the First Target
                        if (m[1] !== effectiveFirstTarget) {
                            secondTarget = m[1];
                            break; // Found the second target
                        }
                    }
                    
                    if (secondTarget) {
                        secondTargetId = getTargetId(secondTarget, row.innerHTML);
                        secondRead = lowerText.includes("doesn't look open") ? "covered" : "open";
                    }
                }
            }

            // 3. Extract Second In Coverage
            let secondInCoverage = "";
            let secondInCoverageId = "";
            // Check if we are in a "Second Read context" (either just found one, or one exists)
            const hasSecondTarget = secondTarget || cpSecondTarget;
            
            if (hasSecondTarget && (lowerText.includes("considers throwing to") || lowerText.includes("coverage") || lowerText.includes("covering"))) {
                const html = row.innerHTML;
                // Pattern 1: "Good coverage by [POSITION]" (when receiver was covered)
                const secondCoverageMatch = text.match(/Good coverage by\s+([A-Z]{1,4}\d{0,2})/i);
                if (secondCoverageMatch) {
                    secondInCoverage = secondCoverageMatch[1];
                } else {
                    // Pattern 2: Extract from italic tag - "<i>[POSITION] ... was the man covering</i>"
                    const italicMatch = html.match(/<i>([A-Z]{1,4}\d{0,2})\s+.*?was the man covering on the play\.<\/i>/i);
                    if (italicMatch) {
                        secondInCoverage = italicMatch[1];
                    }
                }
                
                // Extract Second In Coverage ID
                if (secondInCoverage) {
                    const escapedSecondCoverage = secondInCoverage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const secondCoverageIdMatch = html.match(new RegExp(`Good coverage by\\s+${escapedSecondCoverage}\\s+<a[^>]*lookatplayer=(\\d+)`, 'i'));
                    if (secondCoverageIdMatch) {
                        secondInCoverageId = secondCoverageIdMatch[1];
                    } else {
                        const manCoveringIdMatch = html.match(new RegExp(`${escapedSecondCoverage}\\s+<a[^>]*lookatplayer=(\\d+)[^>]*>.*?was the man covering`, 'i'));
                        if (manCoveringIdMatch) {
                            secondInCoverageId = manCoveringIdMatch[1];
                        } else {
                            const universalMatch = html.match(new RegExp(`\\b${escapedSecondCoverage}\\s+<a[^>]*lookatplayer=(\\d+)`, 'i'));
                            if (universalMatch) {
                                secondInCoverageId = universalMatch[1];
                            }
                        }
                    }
                }
            }

            // 4. Extract Third Read
            let thirdRead = "";
            let thirdTarget = "";
            let thirdTargetId = "";
            
            // Determine current Second Read status (local or effective)
            const currentSecReadStatus = cpSecondRead || secondRead;
            const currentSecTargetName = cpSecondTarget || secondTarget;

            if (currentSecReadStatus === "covered" && lowerText.includes("considers throwing to")) {
                if (!cpThirdTarget) {
                    const matches = Array.from(text.matchAll(/considers throwing to\s+([A-Z]{1,4}\d{0,2})/gi));
                    for (const m of matches) {
                        // Must not be First or Second target
                        if (m[1] !== effectiveFirstTarget && m[1] !== currentSecTargetName) {
                            thirdTarget = m[1];
                            break;
                        }
                    }
                    
                    if (thirdTarget) {
                        thirdTargetId = getTargetId(thirdTarget, row.innerHTML);
                        thirdRead = lowerText.includes("doesn't look open") ? "covered" : "open";
                    }
                }
            }

            // 5. Extract Third In Coverage
            let thirdInCoverage = "";
            let thirdInCoverageId = "";
            const hasThirdTarget = thirdTarget || cpThirdTarget;
            
            if (hasThirdTarget && (lowerText.includes("considers throwing to") || lowerText.includes("coverage") || lowerText.includes("covering"))) {
                const html = row.innerHTML;
                // Pattern 1: "Good coverage by [POSITION]"
                const thirdCoverageMatch = text.match(/Good coverage by\s+([A-Z]{1,4}\d{0,2})/i);
                if (thirdCoverageMatch) {
                    thirdInCoverage = thirdCoverageMatch[1];
                } else {
                    // Pattern 2: "was the man covering"
                    const italicMatch = html.match(/<i>([A-Z]{1,4}\d{0,2})\s+.*?was the man covering on the play\.<\/i>/i);
                    if (italicMatch) {
                        thirdInCoverage = italicMatch[1];
                    }
                }

                if (thirdInCoverage) {
                    const escapedThirdCoverage = thirdInCoverage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const thirdCoverageIdMatch = html.match(new RegExp(`Good coverage by\\s+${escapedThirdCoverage}\\s+<a[^>]*lookatplayer=(\\d+)`, 'i'));
                    if (thirdCoverageIdMatch) {
                        thirdInCoverageId = thirdCoverageIdMatch[1];
                    } else {
                        const manCoveringIdMatch = html.match(new RegExp(`${escapedThirdCoverage}\\s+<a[^>]*lookatplayer=(\\d+)[^>]*>.*?was the man covering`, 'i'));
                        if (manCoveringIdMatch) {
                            thirdInCoverageId = manCoveringIdMatch[1];
                        } else {
                            const universalMatch = html.match(new RegExp(`\\b${escapedThirdCoverage}\\s+<a[^>]*lookatplayer=(\\d+)`, 'i'));
                            if (universalMatch) {
                                thirdInCoverageId = universalMatch[1];
                            }
                        }
                    }
                }
            }

            // 6. Extract Fourth Read
            let fourthRead = "";
            let fourthTarget = "";
            let fourthTargetId = "";
            
            const currentThdReadStatus = cpThirdRead || thirdRead;
            const currentThdTargetName = cpThirdTarget || thirdTarget;

            if (currentThdReadStatus === "covered" && lowerText.includes("considers throwing to")) {
                // Only if we don't already have a Fourth Target
                if (!cpFourthTarget) {
                    const matches = Array.from(text.matchAll(/considers throwing to\s+([A-Z]{1,4}\d{0,2})/gi));
                    for (const m of matches) {
                        // Must not be First, Second, or Third target
                        if (m[1] !== effectiveFirstTarget && 
                            m[1] !== currentSecTargetName && 
                            m[1] !== currentThdTargetName) {
                            fourthTarget = m[1];
                            break;
                        }
                    }
                    
                    if (fourthTarget) {
                        fourthTargetId = getTargetId(fourthTarget, row.innerHTML);
                        fourthRead = lowerText.includes("doesn't look open") ? "covered" : "open";
                    }
                }
            }

            // 7. Extract Fourth In Coverage
            let fourthInCoverage = "";
            let fourthInCoverageId = "";
            const hasFourthTarget = fourthTarget || cpFourthTarget;

            if (hasFourthTarget && (lowerText.includes("considers throwing to") || lowerText.includes("coverage") || lowerText.includes("covering"))) {
                const html = row.innerHTML;
                // Pattern 1: "Good coverage by [POSITION]"
                const fourthCoverageMatch = text.match(/Good coverage by\s+([A-Z]{1,4}\d{0,2})/i);
                if (fourthCoverageMatch) {
                    fourthInCoverage = fourthCoverageMatch[1];
                } else {
                    // Pattern 2: "was the man covering"
                    const italicMatch = html.match(/<i>([A-Z]{1,4}\d{0,2})\s+.*?was the man covering on the play\.<\/i>/i);
                    if (italicMatch) {
                        fourthInCoverage = italicMatch[1];
                    }
                }

                if (fourthInCoverage) {
                    const escapedFourthCoverage = fourthInCoverage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const fourthCoverageIdMatch = html.match(new RegExp(`Good coverage by\\s+${escapedFourthCoverage}\\s+<a[^>]*lookatplayer=(\\d+)`, 'i'));
                    if (fourthCoverageIdMatch) {
                        fourthInCoverageId = fourthCoverageIdMatch[1];
                    } else {
                        const manCoveringIdMatch = html.match(new RegExp(`${escapedFourthCoverage}\\s+<a[^>]*lookatplayer=(\\d+)[^>]*>.*?was the man covering`, 'i'));
                        if (manCoveringIdMatch) {
                            fourthInCoverageId = manCoveringIdMatch[1];
                        } else {
                            const universalMatch = html.match(new RegExp(`\\b${escapedFourthCoverage}\\s+<a[^>]*lookatplayer=(\\d+)`, 'i'));
                            if (universalMatch) {
                                fourthInCoverageId = universalMatch[1];
                            }
                        }
                    }
                }
            }

            // 8. Extract Final In Coverage
            let finalInCoverage = "";
            let finalInCoverageId = "";
            if (lowerText.includes("was the man covering")) {
                const italicMatch = row.innerHTML.match(/<i>([A-Z]{1,4}\d{0,2})\s+.*?was the man covering on the play\.<\/i>/i);
                if (italicMatch) {
                    finalInCoverage = italicMatch[1];
                    
                    const escapedCoverage = finalInCoverage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    // Try "[POSITION] <a...> was the man covering"
                    const manCoveringIdMatch = row.innerHTML.match(new RegExp(`${escapedCoverage}\\s+<a[^>]*lookatplayer=(\\d+)[^>]*>.*?was the man covering`, 'i'));
                    if (manCoveringIdMatch) {
                        finalInCoverageId = manCoveringIdMatch[1];
                    } else {
                        // Universal fallback: position token before link
                        const universalMatch = row.innerHTML.match(new RegExp(`\\b${escapedCoverage}\\s+<a[^>]*lookatplayer=(\\d+)`, 'i'));
                        if (universalMatch) {
                            finalInCoverageId = universalMatch[1];
                        }
                    }
                }
            }

            // Extract Play Type (MOVED UP - needed before firstTarget extraction)
            let playType = "";
            if (lowerText.includes("two minute warning")) {
                playType = "Two Minute Warning";
            } else if (lowerText.includes("time out")) {
                playType = "Timeout";
            } else if (lowerText.includes("onside kick")) {
                playType = "onside kick";
            } else if (lowerText.includes("kickoff")) {
                playType = "kickoff";
            } else if (lowerText.includes("pass")) {
                playType = "pass";
            } else if (lowerText.includes("threw the ball away")) {
                playType = "pass";
            } else if (lowerText.includes("sacked")) {
                playType = "pass";
            } else if (lowerText.includes("handoff")) {
                playType = "run";
            } else if (lowerText.includes("scrambles")) {
                playType = "run";
            } else if (lowerText.includes("field goal")) {
                playType = "field goal";
            } else if (lowerText.includes("punt")) {
                playType = "punt";
            } else if (lowerText.includes("penalty")) {
                playType = "penalty";
            }

            if (playType === "pass") {
                runner = "";
                runnerId = "";
            }
            
            // Extract First In Coverage - defender covering the First Target
            // Can appear on rows before firstTarget is known, so check independently
            let firstInCoverage = "";
            const html = row.innerHTML;
            
            // Pattern 1: "Good coverage by [POSITION]" (when receiver was covered)
            const goodCoverageMatch = text.match(/Good coverage by\s+([A-Z]{1,4}\d{0,2})/i);
            if (goodCoverageMatch) {
                firstInCoverage = goodCoverageMatch[1];
            } else {
                // Pattern 2: Extract from italic tag - "<i>[POSITION] ... was the man covering</i>"
                // The italic tag isolates just the coverage info, so we can be relaxed about the pattern
                // Positions can be with or without numbers (C1, WR2, SLB, MLB, etc.)
                const italicMatch = html.match(/<i>([A-Z]{1,4}\d{0,2})\s+.*?was the man covering on the play\.<\/i>/i);
                if (italicMatch) {
                    firstInCoverage = italicMatch[1];
                }
            }

            // Extract First In Coverage ID from the link
            let firstInCoverageId = "";
            if (firstInCoverage) {
                const escapedCoverage = firstInCoverage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                // Try "Good coverage by [POSITION] <a...lookatplayer=ID"
                const coverageIdMatch = html.match(new RegExp(`(?:Good|Tight) coverage by\\s+${escapedCoverage}\\s+<a[^>]*lookatplayer=(\\d+)`, 'i'));
                if (coverageIdMatch) {
                    firstInCoverageId = coverageIdMatch[1];
                } else {
                    // Try "[POSITION] <a...> was the man covering"
                    const manCoveringIdMatch = html.match(new RegExp(`${escapedCoverage}\\s+<a[^>]*lookatplayer=(\\d+)[^>]*>.*?was the man covering`, 'i'));
                    if (manCoveringIdMatch) {
                        firstInCoverageId = manCoveringIdMatch[1];
                    } else {
                        // Universal fallback: position token before link
                        const universalMatch = html.match(new RegExp(`\\b${escapedCoverage}\\s+<a[^>]*lookatplayer=(\\d+)`, 'i'));
                        if (universalMatch) {
                            firstInCoverageId = universalMatch[1];
                        }
                    }
                }
            }

            // Extract Coverage for Open Target (Final Target) - "was the man covering" logic
            // Handles cases where coverage appears on a line following the "Pass by" line
            if (lowerText.includes("was the man covering")) {
                let openCoverage = "";
                let openCoverageId = "";
                
                const italicMatch = html.match(/<i>([A-Z]{1,4}\d{0,2})\s+.*?was the man covering on the play\.<\/i>/i);
                if (italicMatch) {
                    openCoverage = italicMatch[1];
                }
                
                if (openCoverage) {
                    // Extract ID
                    const escapedOpenCoverage = openCoverage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const openCoverageIdMatch = html.match(new RegExp(`${escapedOpenCoverage}\\s+<a[^>]*lookatplayer=(\\d+)[^>]*>.*?was the man covering`, 'i'));
                    if (openCoverageIdMatch) {
                        openCoverageId = openCoverageIdMatch[1];
                    } else {
                        const universalMatch = html.match(new RegExp(`\\b${escapedOpenCoverage}\\s+<a[^>]*lookatplayer=(\\d+)`, 'i'));
                        if (universalMatch) {
                            openCoverageId = universalMatch[1];
                        }
                    }

                    // Assign to correct slot based on Read Status
                    if (cpFirstRead === "covered") {
                        if (cpSecondRead === "covered") {
                            if (cpThirdRead === "covered") {
                                fourthInCoverage = openCoverage;
                                fourthInCoverageId = openCoverageId;
                            } else {
                                thirdInCoverage = openCoverage;
                                thirdInCoverageId = openCoverageId;
                            }
                        } else {
                            secondInCoverage = openCoverage;
                            secondInCoverageId = openCoverageId;
                        }
                        // Prevent this from being assigned to First In Coverage
                        if (firstInCoverage === openCoverage) {
                            firstInCoverage = "";
                            firstInCoverageId = "";
                        }
                    } else {
                        // First Read is Open (or assumed so), so this is First In Coverage
                        firstInCoverage = openCoverage;
                        firstInCoverageId = openCoverageId;
                    }
                }
            }

            // Extract Possession (ORIGINAL LOGIC)
            let possession = "";
            let offTeam = "";
            let defTeam = "";
            const possEl = row.querySelector('td > span > b');
            if (possEl) {
                const teamAbbr = possEl.textContent.trim();
                offTeam = teamAbbr;

                if (teamAbbr === homeAbbrev) possession = "h";
                else if (teamAbbr === awayAbbrev) possession = "a";
                
                if (offTeam === homeAbbrev) defTeam = awayAbbrev;
                else if (offTeam === awayAbbrev) defTeam = homeAbbrev;
            }

            // Extract Total Yards (Decimal) (ORIGINAL LOGIC - FIXED)
            let totalYards = "";
            if (playType !== "field goal" && playType !== "Timeout" && playType !== "Two Minute Warning" && playType !== "Onside Kick") {
                // For incomplete, dropped, defended, or batted passes, set yards to 0
                if (playType === "pass" && (playResult === "incomplete" || playResult === "drop" || playResult === "pass defended" || playResult === "batted pass")) {
                    totalYards = "0.00";
                } else {
                    let captureYards = false;
                    let searchAfterText = "";
                    let isLoss = false; // Track if this is a loss of yards
                    
                    if (playType === "kickoff" || playType === "punt") {
                        if (lowerText.includes("yards to the")) {
                            captureYards = true;
                            searchAfterText = "yards to the";
                        }
                    } else {
                        if (lowerText.includes("for a gain of")) {
                            captureYards = true;
                            searchAfterText = "for a gain of";
                        } else if (lowerText.includes("for a loss of")) {
                            captureYards = true;
                            searchAfterText = "for a loss of";
                            isLoss = true;
                        } else if (lowerText.includes("sacked") && lowerText.includes("for a")) {
                            // Handle sack format: "SACKED by X for a 3.17 yard loss"
                            captureYards = true;
                            searchAfterText = "for a";
                            isLoss = true;
                        } else if (lowerText.includes("he gains")) {
                            captureYards = true;
                            searchAfterText = "he gains";
                        } else if (lowerText.includes("he ends up gaining")) {
                            captureYards = true;
                            searchAfterText = "he ends up gaining";
                        } else if (lowerText.includes("yards to the")) {
                            captureYards = true;
                            searchAfterText = "yards to the";
                        } else if (lowerText.includes("yard loss")) {
                            captureYards = true;
                            searchAfterText = "yard loss";
                            isLoss = true;
                        }
                    }
                    
                    if (captureYards && searchAfterText) {
                        // Find the position of the search text in the HTML
                        const html = row.innerHTML;
                        const lowerHtml = html.toLowerCase();
                        const afterIndex = lowerHtml.indexOf(searchAfterText);
                        
                        if (afterIndex >= 0) {
                            // Search for supza/supz spans AFTER this position
                            const htmlAfter = html.slice(afterIndex);
                            const supzaMatch = htmlAfter.match(/<span[^>]*class="supza"[^>]*>(-?\d+)<\/span>/i);
                            const supzMatch = htmlAfter.match(/<span[^>]*class="supz"[^>]*>(\d+)<\/span>/i);
                            
                            if (supzaMatch && supzMatch) {
                                let yards = supzaMatch[1] + "." + supzMatch[1];
                                // If this is a loss, make sure the value is negative
                                if (isLoss) {
                                    const yardValue = parseFloat(yards);
                                    if (yardValue > 0) {
                                        yards = "-" + yards;
                                    }
                                }
                                totalYards = yards;
                            } else {
                                // Try alternate underscore format (e.g., "3 __17__ yard loss")
                                const textAfter = text.slice(text.toLowerCase().indexOf(searchAfterText));
                                const underscoreMatch = textAfter.match(/(-?\d+)\s+__(\d+)__/);
                                if (underscoreMatch) {
                                    let yards = underscoreMatch[1] + "." + underscoreMatch[2];
                                    // If this is a loss, make sure the value is negative
                                    if (isLoss) {
                                        const yardValue = parseFloat(yards);
                                        if (yardValue > 0) {
                                            yards = "-" + yards;
                                        }
                                    }
                                    totalYards = yards;
                                }
                            }
                        }
                    }
                }
            }

            // Extract Target Distance for pass plays (ORIGINAL LOGIC)
            let targetDistance = "";
            if (playType === "pass") {
                const downfieldMatch = row.innerHTML.match(PATTERNS.downfield);
                if (downfieldMatch) {
                    targetDistance = downfieldMatch[1] + "." + downfieldMatch[2];
                } else {
                    // Try alternate format with underscores (e.g., "-0 __62__ yard(s) downfield")
                    const underscoreMatch = text.match(/(-?\d+)\s+__(\d+)__\s*yard\(s\)\s*downfield/i);
                    if (underscoreMatch) {
                        targetDistance = underscoreMatch[1] + "." + underscoreMatch[2];
                    } else {
                        // For backward passes or screen passes, target distance equals total yards
                        // Look for "for a LOSS of" or similar patterns
                        if (lowerText.includes('for a loss of') || lowerText.includes('loss of')) {
                            // Extract the loss yardage as negative target distance
                            const lossSpanMatch = row.innerHTML.match(/<span[^>]*class="supza"[^>]*>(-?\d+)<\/span>.*?<span[^>]*class="supz"[^>]*>(\d+)<\/span>/i);
                            if (lossSpanMatch) {
                                let dist = lossSpanMatch[1] + "." + lossSpanMatch[2];
                                const distValue = parseFloat(dist);
                                if (distValue > 0) {
                                    dist = "-" + dist;
                                }
                                targetDistance = dist;
                            } else {
                                const lossUnderscoreMatch = text.match(/(-?\d+)\s+__(\d+)__/);
                                if (lossUnderscoreMatch) {
                                    let dist = lossUnderscoreMatch[1] + "." + lossUnderscoreMatch[2];
                                    const distValue = parseFloat(dist);
                                    if (distValue > 0) {
                                        dist = "-" + dist;
                                    }
                                    targetDistance = dist;
                                }
                            }
                        }
                        // If still no target distance found, default to 0
                        if (!targetDistance) {
                            targetDistance = "0.00";
                        }
                    }
                }
            }

            // Extract Final Target (ORIGINAL LOGIC)
            let finalTarget = "";
            let finalTargetId = "";
            const effectivePlayType = playType || (currentPlay ? currentPlay[7].replace(/"/g, '') : "");
            if (effectivePlayType === "pass") {
                // Try AMAZING catch pattern first
                const amazingFinalMatch = text.match(PATTERNS.amazingCatch);
                if (amazingFinalMatch) {
                    finalTarget = amazingFinalMatch[1];
                }

                if (!finalTarget) {
                let passTargetMatch = text.match(PATTERNS.passTargetFinal);
                if (!passTargetMatch) {
                    const html = row.innerHTML || '';
                    let searchHtml = html;
                    const passIdx = html.toLowerCase().indexOf('pass by');
                    if (passIdx >= 0) {
                        const toIdx = html.toLowerCase().indexOf(' to ', passIdx);
                        if (toIdx >= 0) searchHtml = html.slice(toIdx);
                        else {
                            const toIdx2 = html.toLowerCase().indexOf('to', passIdx);
                            if (toIdx2 >= 0) searchHtml = html.slice(toIdx2);
                        }
                    }
                    const normalizedHtml = searchHtml.replace(PATTERNS.nbsp, ' ');
                    const m2 = normalizedHtml.match(PATTERNS.positionToken);
                    if (m2) passTargetMatch = m2;
                    else {
                        const searchText = normalizedHtml.replace(PATTERNS.tags, ' ').replace(PATTERNS.whitespace, ' ').trim();
                        const afterToText = searchText.split(/to\s+/i)[1] || '';
                        const posMatch = afterToText.match(/^([A-Za-z]{1,4}\d{1,2})\b/);
                        if (posMatch) passTargetMatch = [null, posMatch[1]];
                    }
                }
                if (passTargetMatch) {
                    finalTarget = passTargetMatch[1];
                }

                // Additional robust fallback (ORIGINAL LOGIC)
                if (!finalTarget) {
                    try {
                        const plain = text;
                        const passIdx = plain.toLowerCase().indexOf('pass by');
                        if (passIdx >= 0) {
                            const afterPass = plain.slice(passIdx + 'pass by'.length);
                            const tokens = afterPass.split(/\s+/);
                            const posTokens = tokens.filter(t => PATTERNS.positionTokens.test(t));
                            if (posTokens.length >= 2) {
                                finalTarget = posTokens[1];
                            }
                        }
                    } catch (e) {
                        // ignore
                    }
                }
                } // end if (!finalTarget) for pass-based extraction

                // Extract Final Target ID from the link
                if (finalTarget) {
                    const html = row.innerHTML || '';
                    const escapedFinal = finalTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const finalIdMatch = html.match(new RegExp(`(?:to|DROPPED by|AMAZING catch by)\\s+${escapedFinal}\\s+<a[^>]*lookatplayer=(\\d+)`, 'i'))
                        || html.match(new RegExp(`\\b${escapedFinal}\\s+<a[^>]*lookatplayer=(\\d+)`, 'i'));
                    if (finalIdMatch) {
                        finalTargetId = finalIdMatch[1];
                    }
                }
            }

            // CRITICAL: Check for "Safety on" BEFORE processing timestamp
            // Safety rows have their own timestamp but refer to the previous play
            if (lowerText.includes("safety on")) {
                if (currentPlay) {
                    currentPlay[21] = '"safety"'; // Update previous play's result
                    // Save the previous play before skipping
                    if (currentPlay[11] === '""') {
                        currentPlay[20] = '""'; // Clear Total Yards if no package
                    }
                    rows.push(currentPlay);
                    currentPlay = null;
                }
                continue; // Don't create a new play for the safety itself
            }

            // CRITICAL: Check if this is actually a continuation of the same play (same quarter/time)
            // If so, UPDATE the existing play instead of creating a new one (prevents duplicates)
            // EXCEPTION: Don't merge if current play is a kickoff (kickoffs have same time as first play)
            if (currentPlay) {
                const currentPlayType = currentPlay[7].replace(/"/g, '');
                const isSamePlay = currentPlay[0] === `"${quarter}"` && currentPlay[1] === `"${time}"`;
                const isKickoff = currentPlayType === 'kickoff';
                
                if (isSamePlay && !isKickoff) {
                    // Same play - update it with any new data found in this row
                    if (playType !== "") {
                        currentPlay[7] = `"${playType}"`;
                        if (playType === "pass") {
                            currentPlay[23] = '""'; // Runner
                            currentPlay[24] = '""'; // Runner ID
                        }
                    }
                    if (down !== "") currentPlay[2] = `"${down}"`;
                    if (distance !== "") currentPlay[3] = `"${distance}"`;
                    if (fieldPos !== "") currentPlay[4] = `"${fieldPos}"`;
                    if (totalYards !== "") currentPlay[20] = `"${totalYards}"`;
                    if (playResult !== "") {
                        // Don't let generic "complete" overwrite more specific results like "dump off"
                        const currentResult = currentPlay[21].replace(/"/g, '');
                        if (playResult === "complete" && currentResult === "dump off") {
                            // Keep "dump off", don't overwrite
                        } else if (playResult === "TD" && currentPlay[7] === '"run"') {
                            currentPlay[21] = '"rush, TD"';
                        } else {
                            currentPlay[21] = `"${playResult}"`;
                        }
                    }
                    if (passerId !== "") currentPlay[22] = `"${passerId}"`;
                    if (runner !== "") currentPlay[23] = `"${runner}"`;
                    if (runnerId !== "") currentPlay[24] = `"${runnerId}"`;
                    if (firstRead !== "") {
                        if (firstRead === "open" && currentPlay[26] !== '""') {
                            // Don't overwrite existing status (like "covered") with "open"
                        } else {
                            currentPlay[26] = `"${firstRead}"`;
                        }
                    }
                    if (firstTarget !== "") {
                        if (text.match(/primary option was/i)) {
                            currentPlay[27] = `"${firstTarget}"`;
                            if (firstTargetId !== "") {
                                currentPlay[28] = `"${firstTargetId}"`;
                            }
                        } else if (currentPlay[27] === '""') {
                            currentPlay[27] = `"${firstTarget}"`;
                            if (firstTargetId !== "") {
                                currentPlay[28] = `"${firstTargetId}"`;
                            }
                        }
                    }
                    // Save First In Coverage independently (can appear on any row)
                    if (firstInCoverage !== "") {
                        // Only set if not already set (don't overwrite)
                        if (currentPlay[29] === '""') {
                            currentPlay[29] = `"${firstInCoverage}"`;
                            if (firstInCoverageId !== "") {
                                currentPlay[30] = `"${firstInCoverageId}"`;
                            }
                        }
                    }
                    if (secondRead !== "") currentPlay[31] = `"${secondRead}"`;
                    if (secondTarget !== "") {
                        // Only set Second Target if not already set (don't overwrite)
                        if (currentPlay[32] === '""') {
                            currentPlay[32] = `"${secondTarget}"`;
                            if (secondTargetId !== "") {
                                currentPlay[33] = `"${secondTargetId}"`;
                            }
                        }
                    }
                    // Save Second In Coverage independently (can appear on any row)
                    if (secondInCoverage !== "") {
                        // Only set if not already set (don't overwrite)
                        if (currentPlay[34] === '""') {
                            currentPlay[34] = `"${secondInCoverage}"`;
                            if (secondInCoverageId !== "") {
                                currentPlay[35] = `"${secondInCoverageId}"`;
                            }
                        }
                    }
                    // Save Third Read
                    if (thirdRead !== "") currentPlay[36] = `"${thirdRead}"`;
                    if (thirdTarget !== "") {
                        // Only set Third Target if not already set (don't overwrite)
                        if (currentPlay[37] === '""') {
                            currentPlay[37] = `"${thirdTarget}"`;
                            if (thirdTargetId !== "") {
                                currentPlay[38] = `"${thirdTargetId}"`;
                            }
                        }
                    }
                    // Save Third In Coverage (only set if not already set)
                    if (thirdInCoverage !== "") {
                        if (currentPlay[39] === '""') {
                            currentPlay[39] = `"${thirdInCoverage}"`;
                            if (thirdInCoverageId !== "") {
                                currentPlay[40] = `"${thirdInCoverageId}"`;
                            }
                        }
                    }
                    // Save Fourth Read
                    if (fourthRead !== "") currentPlay[41] = `"${fourthRead}"`;
                    if (fourthTarget !== "") {
                        // Only set Fourth Target if not already set (don't overwrite)
                        if (currentPlay[42] === '""') {
                            currentPlay[42] = `"${fourthTarget}"`;
                            if (fourthTargetId !== "") {
                                currentPlay[43] = `"${fourthTargetId}"`;
                            }
                        }
                    }
                    // Save Fourth In Coverage (only set if not already set)
                    if (fourthInCoverage !== "") {
                        if (currentPlay[44] === '""') {
                            currentPlay[44] = `"${fourthInCoverage}"`;
                            if (fourthInCoverageId !== "") {
                                currentPlay[45] = `"${fourthInCoverageId}"`;
                            }
                        }
                    }
                    if (finalTarget !== "") {
                        currentPlay[46] = `"${finalTarget}"`;
                        if (finalTargetId !== "") currentPlay[47] = `"${finalTargetId}"`;
                    }
                    if (finalInCoverage !== "") {
                        if (currentPlay[48] === '""') currentPlay[48] = `"${finalInCoverage}"`;
                        if (currentPlay[49] === '""' && finalInCoverageId !== "") currentPlay[49] = `"${finalInCoverageId}"`;
                    }
                    if (targetDistance !== "") currentPlay[50] = `"${targetDistance}"`;
                    if (tackler !== "") {
                        currentPlay[52] = `"${tackler}"`;
                        if (tacklerId !== "") currentPlay[53] = `"${tacklerId}"`;
                    }
                    if (pdPosition !== "") {
                        currentPlay[58] = `"${pdPosition}"`;
                        if (pdPositionId !== "") currentPlay[59] = `"${pdPositionId}"`;
                    }
                    if (intPosition !== "") {
                        currentPlay[60] = `"${intPosition}"`;
                        if (intPositionId !== "") currentPlay[61] = `"${intPositionId}"`;
                    }
                    if (tflPosition !== "") {
                        currentPlay[54] = `"${tflPosition}"`;
                        if (tflPositionId !== "") currentPlay[55] = `"${tflPositionId}"`;
                    }
                    if (bdPosition !== "") {
                        currentPlay[56] = `"${bdPosition}"`;
                        if (bdPositionId !== "") currentPlay[57] = `"${bdPositionId}"`;
                    }
                    if (sckPosition !== "" || sckPositionId !== "") {
                        if (currentPlay[62] === '""' && sckPosition !== "") currentPlay[62] = `"${sckPosition}"`;
                        if (currentPlay[63] === '""' && sckPositionId !== "") currentPlay[63] = `"${sckPositionId}"`;
                    }
                    if (skAlwdPosition !== "" || skAlwdPositionId !== "") {
                        if (currentPlay[64] === '""' && skAlwdPosition !== "") currentPlay[64] = `"${skAlwdPosition}"`;
                        if (currentPlay[65] === '""' && skAlwdPositionId !== "") currentPlay[65] = `"${skAlwdPositionId}"`;
                    }
                    if (ffPosition !== "") {
                        if (currentPlay[67] === '""') currentPlay[67] = `"${ffPosition}"`;
                        if (currentPlay[68] === '""' && ffPositionId !== "") currentPlay[68] = `"${ffPositionId}"`;
                    }
                    if (covTxt !== "" || covTxtPos !== "" || covTxtId !== "") {
                        if (currentPlay[69] === '""' && covTxt !== "") currentPlay[69] = `"${covTxt}"`;
                        if (currentPlay[70] === '""' && covTxtPos !== "") currentPlay[70] = `"${covTxtPos}"`;
                        if (currentPlay[71] === '""' && covTxtId !== "") currentPlay[71] = `"${covTxtId}"`;
                    }
                    if (puntDist !== "") {
                        if (currentPlay[72] === '""') currentPlay[72] = `"${puntDist}"`;
                    }
                    if (returnYds !== "") {
                        if (currentPlay[73] === '""') currentPlay[73] = `"${returnYds}"`;
                    }
                    if (returnerId !== "") {
                        if (currentPlay[74] === '""') currentPlay[74] = `"${returnerId}"`;
                    }
                    // Continue to next row without creating new play
                    continue;
                }
                
                // Different play - save the previous one
                if (currentPlay[11] === '""') { // Off Package
                    currentPlay[20] = '""'; // Total Yards
                }
                rows.push(currentPlay);
            }

            // Create new play array (ORIGINAL STRUCTURE)
            currentPlay = [
                `"${quarter}"`, `"${time}"`, `"${down}"`, `"${distance}"`, `"${fieldPos}"`,
                `"${homeScore}"`, `"${awayScore}"`, `"${playType}"`, `"${possession}"`,
                `"${offTeam}"`, `"${defTeam}"`,
                '""', '""', '""', '""', '""', '""', '""', '""', '""', // Package info slots (Now 9 slots: 11-19)
                `"${totalYards}"`,
                `"${playResult}"`,
                `"${passerId}"`, `"${runner}"`, `"${runnerId}"`, '""', // Hole
                `"${firstRead}"`, `"${firstTarget}"`, `"${firstTargetId}"`, `"${firstInCoverage}"`, `"${firstInCoverageId}"`, `"${secondRead}"`, `"${secondTarget}"`, `"${secondTargetId}"`, `"${secondInCoverage}"`, `"${secondInCoverageId}"`, `"${thirdRead}"`, `"${thirdTarget}"`, `"${thirdTargetId}"`, `"${thirdInCoverage}"`, `"${thirdInCoverageId}"`, `"${fourthRead}"`, `"${fourthTarget}"`, `"${fourthTargetId}"`, `"${fourthInCoverage}"`, `"${fourthInCoverageId}"`, `"${finalTarget}"`, `"${finalTargetId}"`, `"${finalInCoverage}"`, `"${finalInCoverageId}"`, `"${targetDistance}"`,
                '""', // YAC placeholder (will be calculated later)
                `"${tackler}"`, `"${tacklerId}"`,
                `"${tflPosition}"`, `"${tflPositionId}"`,
                `"${bdPosition}"`, `"${bdPositionId}"`,
                `"${pdPosition}"`, `"${pdPositionId}"`,
                `"${intPosition}"`, `"${intPositionId}"`,
                `"${sckPosition}"`, `"${sckPositionId}"`,
                `"${skAlwdPosition}"`, `"${skAlwdPositionId}"`,
                '""', // Pressure Type placeholder
                `"${ffPosition}"`, `"${ffPositionId}"`,
                `"${covTxt}"`, `"${covTxtPos}"`, `"${covTxtId}"`,
                `"${puntDist}"`,
                `"${returnYds}"`, `"${returnerId}"`, `"${nextOffPos1}"`, `"${nextOffId1}"`, `"${nextOffPos2}"`, `"${nextOffId2}"`, `"${nextOffPos3}"`, `"${nextOffId3}"`, `"${nextOffPos4}"`, `"${nextOffId4}"`, `"${nextOffPos5}"`, `"${nextOffId5}"`, `"${nextOffPos6}"`, `"${nextOffId6}"`, `"${nextOffPos7}"`, `"${nextOffId7}"`, `"${nextOffPos8}"`, `"${nextOffId8}"`, `"${nextOffPos9}"`, `"${nextOffId9}"`, `"${nextOffPos10}"`, `"${nextOffId10}"`, `"${nextOffPos11}"`, `"${nextOffId11}"`, `"${nextDefPos1}"`, `"${nextDefId1}"`, `"${nextDefPos2}"`, `"${nextDefId2}"`, `"${nextDefPos3}"`, `"${nextDefId3}"`, `"${nextDefPos4}"`, `"${nextDefId4}"`, `"${nextDefPos5}"`, `"${nextDefId5}"`, `"${nextDefPos6}"`, `"${nextDefId6}"`, `"${nextDefPos7}"`, `"${nextDefId7}"`, `"${nextDefPos8}"`, `"${nextDefId8}"`, `"${nextDefPos9}"`, `"${nextDefId9}"`, `"${nextDefPos10}"`, `"${nextDefId10}"`, `"${nextDefPos11}"`, `"${nextDefId11}"`
            ];

            nextOffPos1 = ""; // Reset for next play
            nextOffId1 = ""; // Reset for next play
            nextOffPos2 = ""; // Reset for next play
            nextOffId2 = ""; // Reset for next play
            nextOffPos3 = ""; // Reset for next play
            nextOffId3 = ""; // Reset for next play
            nextOffPos4 = ""; // Reset for next play
            nextOffId4 = ""; // Reset for next play
            nextOffPos5 = ""; // Reset for next play
            nextOffId5 = ""; // Reset for next play
            nextOffPos6 = ""; // Reset for next play
            nextOffId6 = ""; // Reset for next play
            nextOffPos7 = ""; // Reset for next play
            nextOffId7 = ""; // Reset for next play
            nextOffPos8 = "";
            nextOffId8 = "";
            nextOffPos9 = "";
            nextOffId9 = "";
            nextOffPos10 = "";
            nextOffId10 = "";
            nextOffPos11 = "";
            nextOffId11 = "";
            nextDefPos1 = "";
            nextDefId1 = "";
            nextDefPos2 = "";
            nextDefId2 = "";
            nextDefPos3 = "";
            nextDefId3 = "";
            nextDefPos4 = "";
            nextDefId4 = "";
            nextDefPos5 = "";
            nextDefId5 = "";
            nextDefPos6 = "";
            nextDefId6 = "";
            nextDefPos7 = "";
            nextDefId7 = "";
            nextDefPos8 = "";
            nextDefId8 = "";
            nextDefPos9 = "";
            nextDefId9 = "";
            nextDefPos10 = "";
            nextDefId10 = "";
            nextDefPos11 = "";
            nextDefId11 = "";

            // Store current play color
            const firstCellNew = row.cells[0];
            currentPlayColor = firstCellNew ? firstCellNew.getAttribute('bgcolor') : null;

        } else if (text.match(/^Kickoff by/i)) {
            // Handle Initial Kickoff (which may lack a timestamp) (ORIGINAL LOGIC)
            if (currentPlay) {
                rows.push(currentPlay);
            }

            const quarter = lastQuarter;
            const time = lastTime;
            const down = "";
            const distance = "";
            const fieldPos = "35"; // Default kickoff line
            const playType = "kickoff";
            
            // Extract Possession
            let possession = "";
            let offTeam = "";
            let defTeam = "";
            const teamMatch = text.match(/of the (.+?)\./);
            if (teamMatch) {
                const teamName = teamMatch[1];
                if (teamName === homeTeam || homeTeam.includes(teamName)) {
                    possession = "h";
                    offTeam = homeAbbrev;
                    defTeam = awayAbbrev;
                } else if (teamName === awayTeam || awayTeam.includes(teamName)) {
                    possession = "a";
                    offTeam = awayAbbrev;
                    defTeam = homeAbbrev;
                }
            }

            
            const firstCell = row.cells[0];
            currentPlayColor = firstCell ? firstCell.getAttribute('bgcolor') : null;

        } else if (currentPlay) {
            // Process continuation lines for the current play (ORIGINAL LOGIC)
            if (playResult !== "") {
                // Don't let generic "complete" overwrite more specific results like "dump off"
                const currentResult = currentPlay[21].replace(/"/g, ''); // Remove quotes to check value
                if (playResult === "complete" && currentResult === "dump off") {
                    // Keep "dump off", don't overwrite with "complete"
                } else if (playResult === "TD" && currentPlay[7] === '"run"') {
                    currentPlay[21] = '"rush; TD"';
                } else {
                    currentPlay[21] = `"${playResult}"`;
                }
            }

            // Extract Pressure Type from pass rush lines
            if (lowerText.includes("pass rush")) {
                let pressureType = "";
                if (lowerText.includes("relentless")) {
                    pressureType = "relentless";
                } else if (lowerText.includes("massive")) {
                    pressureType = "massive";
                } else if (lowerText.includes("heavy")) {
                    pressureType = "heavy";
                } else if (lowerText.includes("mounting")) {
                    pressureType = "mounting";
                } else if (lowerText.includes("light")) {
                    pressureType = "light";
                }
                if (pressureType !== "") {
                    currentPlay[66] = `"${pressureType}"`;
                }
            }

            // Update tackler if found on continuation line
            if (tackler !== "") {
                if (currentPlay[52] === '""') currentPlay[52] = `"${tackler}"`;
                if (currentPlay[53] === '""' && tacklerId !== "") currentPlay[53] = `"${tacklerId}"`;
            }

            // Update PD if found on continuation line
            if (pdPosition !== "") {
                if (currentPlay[58] === '""') currentPlay[58] = `"${pdPosition}"`;
                if (currentPlay[59] === '""' && pdPositionId !== "") currentPlay[59] = `"${pdPositionId}"`;
            }

            // Update INT if found on continuation line
            if (intPosition !== "") {
                if (currentPlay[60] === '""') currentPlay[60] = `"${intPosition}"`;
                if (currentPlay[61] === '""' && intPositionId !== "") currentPlay[61] = `"${intPositionId}"`;
            }

            // Update TFL if found on continuation line
            if (tflPosition !== "") {
                if (currentPlay[54] === '""') currentPlay[54] = `"${tflPosition}"`;
                if (currentPlay[55] === '""' && tflPositionId !== "") currentPlay[55] = `"${tflPositionId}"`;
            }

            // Update BD if found on continuation line
            if (bdPosition !== "") {
                if (currentPlay[56] === '""') currentPlay[56] = `"${bdPosition}"`;
                if (currentPlay[57] === '""' && bdPositionId !== "") currentPlay[57] = `"${bdPositionId}"`;
            }

            // Update Sack if found on continuation line
            if (sckPosition !== "" || sckPositionId !== "") {
                if (currentPlay[62] === '""' && sckPosition !== "") currentPlay[62] = `"${sckPosition}"`;
                if (currentPlay[63] === '""' && sckPositionId !== "") currentPlay[63] = `"${sckPositionId}"`;
            }

            // Update Sack Allowed if found on continuation line
            if (skAlwdPosition !== "" || skAlwdPositionId !== "") {
                if (currentPlay[64] === '""' && skAlwdPosition !== "") currentPlay[64] = `"${skAlwdPosition}"`;
                if (currentPlay[65] === '""' && skAlwdPositionId !== "") currentPlay[65] = `"${skAlwdPositionId}"`;
            }

            // Update FF if found on continuation line
            if (ffPosition !== "") {
                if (currentPlay[67] === '""') currentPlay[67] = `"${ffPosition}"`;
                if (currentPlay[68] === '""' && ffPositionId !== "") currentPlay[68] = `"${ffPositionId}"`;
            }

            // Update Cov Txt if found on continuation line
            if (covTxt !== "" || covTxtPos !== "" || covTxtId !== "") {
                if (currentPlay[69] === '""' && covTxt !== "") currentPlay[69] = `"${covTxt}"`;
                if (currentPlay[70] === '""' && covTxtPos !== "") currentPlay[70] = `"${covTxtPos}"`;
                if (currentPlay[71] === '""' && covTxtId !== "") currentPlay[71] = `"${covTxtId}"`;
            }

            // Update Punt Dist if found on continuation line
            if (puntDist !== "") {
                if (currentPlay[72] === '""') currentPlay[72] = `"${puntDist}"`;
            }

            // Update Returner Info if found on continuation line
            if (returnYds !== "") {
                if (currentPlay[73] === '""') currentPlay[73] = `"${returnYds}"`;
            }
            if (returnerId !== "") {
                if (currentPlay[74] === '""') currentPlay[74] = `"${returnerId}"`;
            }
            
            // Attempt to extract Final Target from continuation lines (ORIGINAL LOGIC)
            try {
                const isPassPlay = (currentPlay[7] === '"pass"');
                if (isPassPlay) {
                    const contHtml = row.innerHTML || '';
                    let searchHtml = contHtml;
                    const passIdx = contHtml.toLowerCase().indexOf('pass by');
                    if (passIdx >= 0) {
                        const toIdx = contHtml.toLowerCase().indexOf(' to ', passIdx);
                        if (toIdx >= 0) searchHtml = contHtml.slice(toIdx);
                        else {
                            const toIdx2 = contHtml.toLowerCase().indexOf('to', passIdx);
                            if (toIdx2 >= 0) searchHtml = contHtml.slice(toIdx2);
                        }
                    }
                    const normalizedHtml = searchHtml.replace(PATTERNS.nbsp, ' ');
                    const searchText = normalizedHtml.replace(PATTERNS.tags, ' ').replace(PATTERNS.whitespace, ' ').trim();

                    let contFinal = '';
                    const mPos = normalizedHtml.match(PATTERNS.positionToken);
                    if (mPos) contFinal = mPos[1];
                    else {
                        const mAnchor = normalizedHtml.match(/to\s*<a[^>]*>(?:\s*<b>)?([^<\n]+?)(?:<\/b>)?\s*<\/a>/i);
                        if (mAnchor) {
                            const afterToText = searchText.split(/to\s+/i)[1] || '';
                            const posMatch = afterToText.match(/^([A-Za-z]{1,4}\d{1,2})\b/);
                            if (posMatch) contFinal = posMatch[1];
                            else {
                                const anchorPos = mAnchor[1].trim().match(/^([A-Za-z]{1,4}\d{1,2})$/i);
                                if (anchorPos) contFinal = anchorPos[1];
                            }
                        } else {
                            const mSimple = normalizedHtml.match(/to\s+([A-Za-z]{1,4}\d{1,2})/i);
                            if (mSimple) contFinal = mSimple[1];
                        }
                    }
                    if (contFinal && (!currentPlay[27] || currentPlay[27] === '""')) {
                        currentPlay[27] = `"${contFinal}"`;
                    }
                }
            } catch (e) {
                // ignore extraction errors for continuation lines
            }

            // Check for Offensive Package (ORIGINAL LOGIC)
            if (text.includes("Offensive Package Was :")) {
                const pkgMatch = text.match(PATTERNS.offensivePackage);
                if (pkgMatch) {
                    currentPlay[11] = `"${pkgMatch[1].trim()}"`;
                }
                const subPkgMatch = text.match(PATTERNS.subPackage);
                if (subPkgMatch) {
                    currentPlay[12] = `"${subPkgMatch[1].trim()}"`;
                }
                const formMatch = text.match(PATTERNS.formation);
                if (formMatch) {
                    currentPlay[13] = `"${formMatch[1].trim()}"`;
                }
                const offPlayMatch = text.match(PATTERNS.offPlay);
                if (offPlayMatch) {
                    currentPlay[14] = `"${offPlayMatch[1].trim()}"`;
                }
                const defPkgMatch = text.match(PATTERNS.defensivePackage);
                if (defPkgMatch) {
                    currentPlay[15] = `"${defPkgMatch[1].trim()}"`;
                }
                const covMatch = text.match(PATTERNS.coverage);
                if (covMatch) {
                    currentPlay[16] = `"${covMatch[1].trim()}"`;
                }
                const depthParts = text.split(';');
                if (depthParts.length > 1) {
                    const potentialDepth = depthParts[depthParts.length - 1].trim();
                    if (potentialDepth && !potentialDepth.includes("Roamer Job") && !potentialDepth.includes("Coverage :")) {
                        currentPlay[17] = `"${potentialDepth}"`;
                    }
                }
                // Default Roamer Job to "none" since defense is present
                if (currentPlay[18] === '""') {
                    currentPlay[18] = '"none"';
                }
                const roamerMatch = text.match(PATTERNS.roamerJob);
                if (roamerMatch) {
                    currentPlay[18] = `"${roamerMatch[1].trim()}"`;
                }
                const blitzMatch = text.match(PATTERNS.blitzing);
                if (blitzMatch) {
                    currentPlay[19] = `"${blitzMatch[1].trim()}"`;
                }
                
                // Extract hole for run plays
                if (currentPlay[7] === '"run"') {
                    // First try: "thru X hole" format in the play description
                    const holeMatch = text.match(PATTERNS.hole);
                    if (holeMatch) {
                        currentPlay[25] = `"${holeMatch[1].trim()}"`;
                    } else {
                        // Second try: Check Play field for hole designation (e.g., "FB smash R1 hol")
                        const playHoleMatch = text.match(/Play\s*:\s*.*?([A-Z]{1,2}\d{1,2})\s+hol/i);
                        if (playHoleMatch) {
                            currentPlay[25] = `"${playHoleMatch[1]}"`;
                        } else {
                            // Third try: Check if this is a draw play
                            const playMatch = text.match(/Play\s*:\s*Draw Play/i);
                            if (playMatch) {
                                currentPlay[25] = '"draw"';
                            } else {
                                // Fourth try: Check for sweep plays (e.g., "H sweep left" or "H sweep right")
                                const sweepMatch = text.match(/Play\s*:\s*(?:H|FB)?\s*sweep\s+(left|right)/i);
                                if (sweepMatch) {
                                    currentPlay[25] = `"sweep ${sweepMatch[1].toLowerCase()}"`;
                                }
                            }
                        }
                    }
                }

                if (lowerText.includes("primary option") && currentPlay[26] === '""') {
                    currentPlay[26] = '"covered"';
                }
            }
        }
    }
    
    // Push the final play if exists (ORIGINAL LOGIC)
    if (currentPlay) {
        if (currentPlay[11] === '""') { // Off Package
            currentPlay[20] = '"0"'; // Total Yards
        }
        rows.push(currentPlay);
    }

    // Post-process all plays to ensure incomplete/dropped/defended/batted passes have 0 yards
    rows.forEach(play => {
        const playType = play[7]; // Index 7 is Play Type
        const playResult = play[21]; // Index 21 is Play Result
        
        if (playType === '"pass"' && (playResult === '"incomplete"' || playResult === '"drop"' || playResult === '"pass defended"' || playResult === '"batted pass"')) {
            play[20] = '"0.00"'; // Set Total Yards to 0
        }
    });

    // Convert short yardage text to decimal approximations
    rows.forEach((play, index) => {
        const distance = play[3].replace(/"/g, '').trim(); // Index 3 is Distance
        const distanceLower = distance.toLowerCase();
        
        // Convert text distances to decimal approximations
        if (distanceLower.includes('&lt; 1') || distanceLower.includes('< 1')) {
            play[3] = '"0.50"'; // Less than 1 yard, assume 0.5
        } else if (distanceLower.includes('inch')) {
            play[3] = '"0.25"'; // Inches, assume 0.25 yards (9 inches)
        } else if (distanceLower.includes('foot')) {
            play[3] = '"0.33"'; // Foot, assume 0.33 yards (1 foot)
        }
    });

    // Calculate Yards After Catch for all pass plays
    // YAC = Total Yards - Target Distance (only for pass plays)
    rows.forEach(play => {
        const playType = play[7]; // Index 7 is Play Type
        const playResult = play[21]; // Index 21 is Play Result
        const totalYards = play[20]; // Index 20 is Total Yards
        const targetDistance = play[50]; // Index 50 is Target Distance
        
        let yac = '';
        
        // Parse total yards for various checks
        const yardsValue = totalYards !== '""' ? parseFloat(totalYards.replace(/"/g, '')) : NaN;
        
        // Set YAC to 0 for specific situations:
        // 1. Sacks (no catch)
        // 2. Incomplete passes (no catch)
        // 3. Pass defended (no catch)
        // 4. Batted passes (no catch)
        // 5. Dropped passes (no catch)
        // 6. Penalties with 0 or negative yards
        // 7. Fumbles with negative yards
        if (playResult === '"sack"' ||
            playResult === '"incomplete"' ||
            playResult === '"pass defended"' ||
            playResult === '"batted pass"' ||
            playResult === '"drop"' ||
            (playResult === '"penalty"' && !isNaN(yardsValue) && yardsValue <= 0) ||
            (playResult === '"fumble"' && !isNaN(yardsValue) && yardsValue < 0)) {
            yac = '0.00';
        } else if (playType === '"pass"' && totalYards !== '""' && targetDistance !== '""') {
            try {
                const yards = parseFloat(totalYards.replace(/"/g, ''));
                const distance = parseFloat(targetDistance.replace(/"/g, ''));
                
                // Calculate YAC if both values are valid
                // Now handles negative values correctly (backward passes, losses)
                if (!isNaN(yards) && !isNaN(distance)) {
                    yac = (yards - distance).toFixed(2);
                }
            } catch (e) {
                // If parsing fails, leave YAC empty
            }
        }
        
        // Set YAC at index 31 (already initialized as empty string)
        play[51] = `"${yac}"`; // Index 51 is YAC
    });

    // Detect safeties based on field position and yardage
    rows.forEach(play => {
        const fieldPos = play[4]; // Index 4 is Field Position
        const totalYards = play[20]; // Index 20 is Total Yards
        const playResult = play[21]; // Index 21 is Play Result
        
        // Skip if already marked as safety
        if (playResult === '"safety"') return;
        
        try {
            // Parse field position (format: "-1" for own 1-yard line, "-50" for own 50)
            const fieldPosValue = parseFloat(fieldPos.replace(/"/g, ''));
            const yardsValue = parseFloat(totalYards.replace(/"/g, ''));
            
            // Check if play resulted in a safety:
            // Starting in own territory (negative field position between -1 and -99)
            // AND the play results in being tackled in the end zone
            if (!isNaN(fieldPosValue) && !isNaN(yardsValue) && 
                fieldPosValue < 0 && fieldPosValue > -100) {
                
                const startingYardLine = Math.abs(fieldPosValue); // Distance from own goal line
                const yardsLost = -yardsValue; // Positive if loss
                
                // Safety occurs if they lose more yards than their starting position from goal
                // e.g., at own 1 (-1), lose 2 yards → tackled 1 yard deep in end zone
                if (yardsLost > startingYardLine) {
                    play[21] = '"safety"';
                }
            }
        } catch (e) {
            // Ignore parsing errors
        }
    });

    // Infer Second/Third/Fourth Read for plays where a read was covered and a pass was thrown
    rows.forEach(play => {
        const playType = play[7]; // Index 7 is Play Type
        const firstRead = play[26]; // Index 26 is First Read
        const firstTarget = play[27]; // Index 27 is First Target
        const secondRead = play[31]; // Index 31 is Second Read
        const secondTarget = play[32]; // Index 32 is Second Target
        const thirdRead = play[36]; // Index 36 is Third Read
        const thirdTarget = play[37]; // Index 37 is Third Target
        const fourthRead = play[41]; // Index 41 is Fourth Read
        const finalTarget = play[46]; // Index 46 is Final Target
        const finalTargetId = play[47]; // Index 47 is Final Target ID

        // If First Read was covered and Second Read is empty, infer Second Read from Final Target
        if (playType === '"pass"' && 
            firstRead === '"covered"' && 
            secondRead === '""' && 
            finalTarget !== '""' &&
            finalTarget !== firstTarget) {
            play[31] = '"open"';
            if (play[32] === '""') play[32] = finalTarget;
            if (play[33] === '""' && finalTargetId !== '""') play[33] = finalTargetId;
        }

        // If Second Read was covered and Third Read is empty, infer Third Read from Final Target
        if (playType === '"pass"' && 
            secondRead === '"covered"' && 
            thirdRead === '""' && 
            finalTarget !== '""' &&
            finalTarget !== secondTarget &&
            finalTarget !== firstTarget) {
            play[36] = '"open"';
            if (play[37] === '""') play[37] = finalTarget;
            if (play[38] === '""' && finalTargetId !== '""') play[38] = finalTargetId;
        }

        // If Third Read was covered and Fourth Read is empty, infer Fourth Read from Final Target
        if (playType === '"pass"' && 
            thirdRead === '"covered"' && 
            fourthRead === '""' && 
            finalTarget !== '""' &&
            finalTarget !== thirdTarget &&
            finalTarget !== secondTarget &&
            finalTarget !== firstTarget) {
            play[41] = '"open"';
            if (play[42] === '""') play[42] = finalTarget;
            if (play[43] === '""' && finalTargetId !== '""') play[43] = finalTargetId;
        }
    });

    return rows;
}

// ============================================================================
// INITIALIZATION
// ============================================================================

// Inject the button when the script loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectDownloadButton);
} else {
    injectDownloadButton();
}

/**
 * Provide dependency-free article search for the Publii theme.
 *
 * This module opens and manages the global search drawer, reads a compact
 * article index embedded by the theme, and matches titles, tags, and
 * summaries. It renders safe DOM nodes for results and manages focus,
 * drawer closing, empty, and error states.
 *
 * Input: Theme-rendered article data and visitor search terms.
 * Output: Ranked links to matching articles inside the search drawer.
 * Side effects: Reads inert template content and toggles drawer/body state.
 */
(function (root, factory) {
    'use strict';

    var search = factory();

    if (typeof module === 'object' && module.exports) {
        module.exports = search;
    }

    if (root && root.document) {
        search.init(root.document, root);
    }
}(typeof window !== 'undefined' ? window : null, function () {
    'use strict';

    var MIN_QUERY_LENGTH = 2;
    var MAX_RESULTS = 10;

    function htmlToText(value) {
        var source = String(value || '');

        if (typeof DOMParser !== 'undefined') {
            return new DOMParser()
                .parseFromString(source, 'text/html')
                .body.textContent || '';
        }

        return source
            .replace(/<[^>]*>/g, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;|&apos;/gi, "'")
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&hellip;/gi, '…')
            .replace(/&nbsp;/gi, ' ');
    }

    function normalizeText(value) {
        var text = htmlToText(value)
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();

        if (typeof text.normalize === 'function') {
            text = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        }

        return text;
    }

    function normalizeTags(tags) {
        if (!Array.isArray(tags)) {
            return [];
        }

        return tags
            .map(function (tag) {
                return typeof tag === 'string' ? tag : (tag && tag.name) || '';
            })
            .map(function (tag) {
                return htmlToText(tag).replace(/\s+/g, ' ').trim();
            })
            .filter(Boolean);
    }

    function prepareArticle(item) {
        var article = item || {};
        var title = htmlToText(article.title).replace(/\s+/g, ' ').trim();
        var summary = htmlToText(article.summary).replace(/\s+/g, ' ').trim();
        var tags = normalizeTags(article.tags);

        return {
            title: title,
            summary: summary,
            tags: tags,
            url: article.url || article.id || '',
            datePublished: article.date_published || '',
            searchTitle: normalizeText(title),
            searchTags: normalizeText(tags.join(' ')),
            searchSummary: normalizeText(summary)
        };
    }

    function prepareArticles(items) {
        if (!Array.isArray(items)) {
            return [];
        }

        return items
            .map(prepareArticle)
            .filter(function (article) {
                return article.title && article.url;
            });
    }

    function readEmbeddedArticles(doc) {
        var template = doc.getElementById('siteSearchData');

        if (!template) {
            return [];
        }

        var source = template.content || template;
        var items = Array.prototype.slice.call(
            source.querySelectorAll('[data-search-item]')
        );

        return items.map(function (item) {
            var title = item.querySelector('[data-search-title]');
            var summary = item.querySelector('[data-search-summary]');
            var tags = Array.prototype.slice.call(
                item.querySelectorAll('[data-search-tags] li')
            ).map(function (tag) {
                return tag.textContent || '';
            });

            return {
                title: title ? title.textContent : '',
                summary: summary ? summary.textContent : '',
                tags: tags,
                url: item.getAttribute('data-search-url') || ''
            };
        });
    }

    function searchArticles(items, rawQuery, limit) {
        var query = normalizeText(rawQuery);
        var resultLimit = Number.isFinite(limit) && limit > 0 ? limit : MAX_RESULTS;

        if (query.length < MIN_QUERY_LENGTH) {
            return [];
        }

        var tokens = query.split(' ').filter(Boolean);
        var articles = (items || []).map(function (item) {
            return item && item.searchTitle !== undefined ? item : prepareArticle(item);
        });

        return articles
            .map(function (article, position) {
                var combined = [
                    article.searchTitle,
                    article.searchTags,
                    article.searchSummary
                ].join(' ');

                if (!tokens.every(function (token) {
                    return combined.indexOf(token) !== -1;
                })) {
                    return null;
                }

                var score = 0;

                if (article.searchTitle === query) {
                    score += 20;
                } else if (article.searchTitle.indexOf(query) === 0) {
                    score += 12;
                } else if (article.searchTitle.indexOf(query) !== -1) {
                    score += 8;
                }

                tokens.forEach(function (token) {
                    if (article.searchTitle.indexOf(token) !== -1) {
                        score += 4;
                    }
                    if (article.searchTags.indexOf(token) !== -1) {
                        score += 3;
                    }
                    if (article.searchSummary.indexOf(token) !== -1) {
                        score += 1;
                    }
                });

                return {
                    article: article,
                    score: score,
                    position: position
                };
            })
            .filter(Boolean)
            .sort(function (left, right) {
                return right.score - left.score || left.position - right.position;
            })
            .slice(0, resultLimit)
            .map(function (result) {
                return result.article;
            });
    }

    function init(doc, win) {
        var toggle = doc.getElementById('searchPanelToggle');
        var panel = doc.getElementById('siteSearchPanel');
        var dialog = panel && panel.querySelector('.site-search-panel__dialog');
        var form = doc.getElementById('siteSearchForm');
        var input = doc.getElementById('siteSearchInput');
        var status = doc.getElementById('siteSearchStatus');
        var results = doc.getElementById('siteSearchResults');

        if (!toggle || !panel || !dialog || !form || !input || !status || !results) {
            return;
        }

        var articles = prepareArticles(readEmbeddedArticles(doc));
        var hideTimer = null;
        var searchTimer = null;
        var previousFocus = null;

        function clearResults() {
            while (results.firstChild) {
                results.removeChild(results.firstChild);
            }
        }

        function setStatus(message, state) {
            status.textContent = message;
            status.dataset.state = state || '';
            panel.classList.toggle(
                'has-results',
                state === 'results' || state === 'empty' || state === 'error'
            );
        }

        function createResult(article) {
            var item = doc.createElement('li');
            var link = doc.createElement('a');
            var title = doc.createElement('h3');
            var summary = doc.createElement('p');

            item.className = 'site-search-results__item';
            link.className = 'site-search-results__link';
            link.href = article.url;
            title.className = 'site-search-results__title';
            title.textContent = article.title;
            summary.className = 'site-search-results__summary';
            summary.textContent = article.summary;

            link.appendChild(title);

            if (article.tags.length) {
                var tags = doc.createElement('p');
                tags.className = 'site-search-results__tags';
                tags.textContent = article.tags.join(' · ');
                link.appendChild(tags);
            }

            if (article.summary) {
                link.appendChild(summary);
            }

            item.appendChild(link);
            return item;
        }

        function renderSearch() {
            var query = input.value.trim();

            clearResults();

            if (query.length < MIN_QUERY_LENGTH) {
                setStatus('Type at least 2 characters.', 'idle');
                return;
            }

            if (!articles.length) {
                setStatus('Search index is unavailable.', 'error');
                return;
            }

            var matches = searchArticles(articles, query, MAX_RESULTS);

            if (!matches.length) {
                setStatus('No articles found. Try another search.', 'empty');
                return;
            }

            var fragment = doc.createDocumentFragment();
            matches.forEach(function (article) {
                fragment.appendChild(createResult(article));
            });
            results.appendChild(fragment);

            setStatus(
                matches.length + (matches.length === 1 ? ' article found.' : ' articles found.'),
                'results'
            );
        }

        function openPanel() {
            if (hideTimer) {
                win.clearTimeout(hideTimer);
                hideTimer = null;
            }

            previousFocus = doc.activeElement;
            panel.hidden = false;
            toggle.setAttribute('aria-expanded', 'true');
            doc.body.classList.add('search-panel-open');

            win.requestAnimationFrame(function () {
                panel.classList.add('is-open');
                input.focus();
            });

            renderSearch();
        }

        function closePanel() {
            panel.classList.remove('is-open');
            panel.classList.remove('has-results');
            toggle.setAttribute('aria-expanded', 'false');
            doc.body.classList.remove('search-panel-open');

            hideTimer = win.setTimeout(function () {
                panel.hidden = true;
                hideTimer = null;
            }, 240);

            if (previousFocus && typeof previousFocus.focus === 'function') {
                previousFocus.focus();
            } else {
                toggle.focus();
            }
        }

        toggle.addEventListener('click', openPanel);

        panel.addEventListener('click', function (event) {
            var closeControl = event.target.closest &&
                event.target.closest('[data-search-close]');

            if (closeControl && panel.contains(closeControl)) {
                closePanel();
            }
        });

        form.addEventListener('submit', function (event) {
            event.preventDefault();
            renderSearch();
        });

        input.addEventListener('input', function () {
            win.clearTimeout(searchTimer);
            searchTimer = win.setTimeout(renderSearch, 100);
        });

        input.addEventListener('search', renderSearch);

        doc.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && !panel.hidden) {
                closePanel();
            }
        });

        doc.addEventListener('click', function (event) {
            if (
                !panel.hidden &&
                !panel.contains(event.target) &&
                !toggle.contains(event.target)
            ) {
                closePanel();
            }
        });
    }

    return {
        htmlToText: htmlToText,
        normalizeText: normalizeText,
        prepareArticles: prepareArticles,
        readEmbeddedArticles: readEmbeddedArticles,
        searchArticles: searchArticles,
        init: init
    };
}));

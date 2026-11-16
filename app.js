const TMDB_API_KEY = 'dd7b6eb795cb2cd7110e68bf233cf110';

const firebaseConfig = {
  apiKey: "AIzaSyBCeSoRVfDGT1mfxXiDBJjxTWTuDc2y8jo",
  authDomain: "api-nossos-filmes.firebaseapp.com",
  projectId: "api-nossos-filmes",
  storageBucket: "api-nossos-filmes.firebasestorage.app",
  messagingSenderId: "421231080415",
  appId: "1:421231080415:web:5199e40f39376ca77f4a6a",
  measurementId: "G-ZS4MWZ7021"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const moviesCollection = db.collection('movies');

let allMovies = [];
let filteredMovies = [];
let directors = new Set();
let currentQuickFilter = 'all';
let searchDebounceTimeout = null;
let currentOpenMovieId = null;

// Estados da Seleção Múltipla
let isSelectionMode = false;
let selectedMovieIds = new Set();

const moviesGrid = document.getElementById('movies-grid');
const searchInput = document.getElementById('search-input');
const sortSelect = document.getElementById('sort-select');
const directorSelect = document.getElementById('director-select');
const resultsCountText = document.getElementById('results-count');

const btnToggleSelect = document.getElementById('btn-toggle-select');
const bulkActionBar = document.getElementById('bulk-action-bar');
const bulkSelectedCount = document.getElementById('bulk-selected-count');

const heroSection = document.getElementById('hero-section');
const heroBg = document.getElementById('hero-bg');
const heroTitle = document.getElementById('hero-title');
const heroYear = document.getElementById('hero-year');
const heroScore = document.getElementById('hero-score');
const heroDuration = document.getElementById('hero-duration');
const heroDesc = document.getElementById('hero-desc');

const modalOverlay = document.getElementById('modal-overlay');
const modalBannerImg = document.getElementById('modal-banner-img');
const modalPosterImg = document.getElementById('modal-poster-img');
const modalTitle = document.getElementById('modal-title');
const modalJapaneseTitle = document.getElementById('modal-japanese-title');
const modalScore = document.getElementById('modal-score');
const modalYear = document.getElementById('modal-year');
const modalDuration = document.getElementById('modal-duration');
const modalSynopsisText = document.getElementById('modal-synopsis-text');
const modalDirector = document.getElementById('modal-director');
const modalProducer = document.getElementById('modal-producer');
const modalProvidersList = document.getElementById('modal-providers-list');
const modalPersonalNotes = document.getElementById('modal-personal-notes');

const addModalOverlay = document.getElementById('add-modal-overlay');
const addMovieForm = document.getElementById('add-movie-form');
const tmdbSearchInput = document.getElementById('tmdb-search-input');
const tmdbAutocompleteList = document.getElementById('tmdb-autocomplete-list');
const btnSubmitMovie = document.getElementById('btn-submit-movie');

// --- NOTIFICAÇÕES TOAST ---
function showToast(message, iconClass = 'fa-circle-check') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<i class="fa-solid ${iconClass}"></i> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3200);
}

// --- SINCRONIZAÇÃO FIRESTORE ---
function initRealtimeSync() {
    moviesCollection.onSnapshot((snapshot) => {
        allMovies = [];
        snapshot.forEach((doc) => {
            allMovies.push({ id: doc.id, ...doc.data() });
        });

        const validIds = new Set(allMovies.map(m => m.id));
        selectedMovieIds.forEach(id => {
            if (!validIds.has(id)) selectedMovieIds.delete(id);
        });

        filteredMovies = [...allMovies];
        extractDirectors();
        if (!heroTitle.dataset.loaded) {
            setupHero();
            heroTitle.dataset.loaded = 'true';
        }
        updateQuickPillState();
        applyFiltersAndSort();
        updateBulkBarUI();

        // Atualiza estrelas em tempo real se o modal estiver aberto
        if (currentOpenMovieId && modalOverlay.classList.contains('active')) {
            const openMovie = allMovies.find(m => m.id === currentOpenMovieId);
            if (openMovie) renderStarRating(openMovie.user_rating || 0);
        }
    }, (error) => {
        console.error("Erro ao sincronizar com o Firestore:", error);
        resultsCountText.textContent = "Falha ao conectar com o banco de dados.";
    });
}

// --- ROLETA DE SORTEIO ("O QUE ASSISTIR?") ---
function startMovieRoulette() {
    let pool = allMovies.filter(m => m.status === 'watchlist');
    let sourceLabel = 'lista Quero Ver';

    if (pool.length === 0) {
        pool = allMovies;
        sourceLabel = 'catálogo completo';
    }

    if (pool.length === 0) {
        showToast('Adicione filmes ao catálogo antes de sortear!', 'fa-circle-exclamation');
        return;
    }

    if (pool.length === 1) {
        showToast(`Único filme disponível na ${sourceLabel}!`, 'fa-dice');
        openModal(pool[0].id);
        return;
    }

    const overlay = document.getElementById('roulette-overlay');
    const titleDisplay = document.getElementById('roulette-title');
    overlay.classList.add('active');

    let ticks = 0;
    const maxTicks = 18;
    const interval = setInterval(() => {
        const randomMovie = pool[Math.floor(Math.random() * pool.length)];
        titleDisplay.textContent = randomMovie.title;
        ticks++;

        if (ticks >= maxTicks) {
            clearInterval(interval);
            const winner = pool[Math.floor(Math.random() * pool.length)];
            titleDisplay.textContent = `🎉 ${winner.title}`;

            setTimeout(() => {
                overlay.classList.remove('active');
                openModal(winner.id);
                showToast(`Filme sorteado da ${sourceLabel}!`, 'fa-dice');
            }, 850);
        }
    }, 90);
}

// --- SELEÇÃO MÚLTIPLA E AÇÕES EM LOTE ---
function toggleSelectionMode() {
    isSelectionMode = !isSelectionMode;
    selectedMovieIds.clear();

    if (isSelectionMode) {
        btnToggleSelect.classList.add('active');
        btnToggleSelect.innerHTML = '<i class="fa-solid fa-xmark"></i> Cancelar Seleção';
    } else {
        btnToggleSelect.classList.remove('active');
        btnToggleSelect.innerHTML = '<i class="fa-regular fa-square-check"></i> Selecionar Vários';
    }

    updateBulkBarUI();
    renderCards();
}

function toggleMovieSelection(id) {
    if (selectedMovieIds.has(id)) {
        selectedMovieIds.delete(id);
    } else {
        selectedMovieIds.add(id);
    }
    updateBulkBarUI();
    renderCards();
}

function selectAllFiltered() {
    const allFilteredSelected = filteredMovies.length > 0 && filteredMovies.every(m => selectedMovieIds.has(m.id));
    if (allFilteredSelected) {
        filteredMovies.forEach(m => selectedMovieIds.delete(m.id));
    } else {
        filteredMovies.forEach(m => selectedMovieIds.add(m.id));
    }
    updateBulkBarUI();
    renderCards();
}

function updateBulkBarUI() {
    bulkSelectedCount.textContent = selectedMovieIds.size;
    if (isSelectionMode && selectedMovieIds.size > 0) {
        bulkActionBar.classList.add('visible');
    } else {
        bulkActionBar.classList.remove('visible');
    }
}

async function bulkSetStatus(status) {
    const count = selectedMovieIds.size;
    if (count === 0) return;

    const batch = db.batch();
    selectedMovieIds.forEach(id => {
        batch.update(moviesCollection.doc(id), { status: status });
    });

    try {
        await batch.commit();
        toggleSelectionMode();
        showToast(`${count} filme(s) atualizado(s)!`);
    } catch (err) {
        console.error("Erro na atualização em lote:", err);
        showToast("Erro ao atualizar os filmes selecionados.", "fa-triangle-exclamation");
    }
}

async function bulkDeleteMovies() {
    const count = selectedMovieIds.size;
    if (count === 0) return;

    if (!confirm(`Deseja realmente remover ${count} filme(s) selecionado(s) da biblioteca?`)) return;

    const batch = db.batch();
    selectedMovieIds.forEach(id => {
        batch.delete(moviesCollection.doc(id));
    });

    try {
        await batch.commit();
        toggleSelectionMode();
        showToast(`${count} filme(s) removido(s) do catálogo.`, "fa-trash");
    } catch (err) {
        console.error("Erro na exclusão em lote:", err);
        showToast("Erro ao excluir os filmes.", "fa-triangle-exclamation");
    }
}

function handleCardClick(id) {
    if (isSelectionMode) {
        toggleMovieSelection(id);
    } else {
        openModal(id);
    }
}

// --- AÇÕES INDIVIDUAIS ---
async function setMovieStatus(id, status, event) {
    if (event) event.stopPropagation();
    const movie = allMovies.find(m => m.id === id);
    if (!movie) return;

    const newStatus = movie.status === status ? null : status;

    try {
        await moviesCollection.doc(id).update({ status: newStatus });
        const label = newStatus === 'watchlist' ? 'Adicionado a Quero Ver' : newStatus === 'watched' ? 'Marcado como Assistido' : 'Status removido';
        showToast(label);
    } catch (err) {
        console.error("Erro ao atualizar status:", err);
    }
}

async function deleteMovie(id, event) {
    if (event) event.stopPropagation();
    if (!confirm('Deseja realmente remover este filme da biblioteca compartilhada?')) return;

    try {
        await moviesCollection.doc(id).delete();
        if (modalOverlay.classList.contains('active')) closeModal();
        showToast('Filme excluído do catálogo.', 'fa-trash');
    } catch (err) {
        console.error("Erro ao excluir filme:", err);
    }
}

// --- AVALIAÇÃO PESSOAL E ANOTAÇÕES ---
function renderStarRating(rating) {
    const stars = document.querySelectorAll('#modal-star-rating i');
    stars.forEach(star => {
        const val = parseInt(star.dataset.value);
        if (val <= rating) {
            star.classList.remove('fa-regular');
            star.classList.add('fa-solid');
        } else {
            star.classList.remove('fa-solid');
            star.classList.add('fa-regular');
        }
    });
}

async function setPersonalRating(rating) {
    if (!currentOpenMovieId) return;
    const movie = allMovies.find(m => m.id === currentOpenMovieId);
    const newRating = movie && movie.user_rating === rating ? 0 : rating;

    renderStarRating(newRating);
    try {
        await moviesCollection.doc(currentOpenMovieId).update({ user_rating: newRating });
        showToast(newRating > 0 ? `Nota pessoal: ${newRating}/5 estrelas!` : 'Nota pessoal removida', 'fa-star');
    } catch (err) {
        console.error("Erro ao salvar nota pessoal:", err);
    }
}

async function savePersonalNotes() {
    if (!currentOpenMovieId) return;
    const notes = modalPersonalNotes.value.trim();
    const btn = document.getElementById('btn-save-notes');
    btn.disabled = true;

    try {
        await moviesCollection.doc(currentOpenMovieId).update({ personal_notes: notes });
        showToast('Anotação salva na biblioteca compartilhada!');
    } catch (err) {
        console.error("Erro ao salvar anotação:", err);
        showToast('Erro ao salvar anotação.', 'fa-triangle-exclamation');
    } finally {
        btn.disabled = false;
    }
}

// --- ONDE ASSISTIR (WATCH PROVIDERS BR DO TMDB) ---
async function loadWatchProviders(movie) {
    modalProvidersList.innerHTML = '<span class="provider-empty">Buscando streamings...</span>';
    let tmdbId = movie.tmdb_id;

    try {
        // Se for um filme antigo sem tmdb_id salvo, busca o ID pelo título
        if (!tmdbId) {
            const searchUrl = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&language=pt-BR&query=${encodeURIComponent(movie.title)}`;
            const searchRes = await fetch(searchUrl);
            const searchData = await searchRes.json();
            if (searchData.results && searchData.results.length > 0) {
                tmdbId = searchData.results[0].id;
            }
        }

        if (!tmdbId) {
            modalProvidersList.innerHTML = '<span class="provider-empty">Indisponível no catálogo BR.</span>';
            return;
        }

        const url = `https://api.themoviedb.org/3/movie/${tmdbId}/watch/providers?api_key=${TMDB_API_KEY}`;
        const res = await fetch(url);
        const data = await res.json();

        const brData = data.results && data.results.BR;
        const providers = brData && (brData.flatrate || brData.free || brData.ads);

        if (!providers || providers.length === 0) {
            modalProvidersList.innerHTML = '<span class="provider-empty">Não disponível por assinatura no BR.</span>';
            return;
        }

        modalProvidersList.innerHTML = '';
        providers.slice(0, 6).forEach(p => {
            const img = document.createElement('img');
            img.src = `https://image.tmdb.org/t/p/w92${p.logo_path}`;
            img.alt = p.provider_name;
            img.title = `Disponível em: ${p.provider_name}`;
            img.className = 'provider-logo';
            modalProvidersList.appendChild(img);
        });
    } catch (err) {
        console.error("Erro ao buscar watch providers:", err);
        modalProvidersList.innerHTML = '<span class="provider-empty">Erro ao carregar plataformas.</span>';
    }
}

// --- FILTROS, DIRETORES E RENDERIZAÇÃO ---
function extractDirectors() {
    directors.clear();
    const currentSelection = directorSelect.value;
    directorSelect.innerHTML = '<option value="all">Todos os Diretores</option>';
    
    allMovies.forEach(movie => {
        if (movie.director && movie.director !== 'Desconhecido') {
            directors.add(movie.director);
        }
    });

    directors.forEach(director => {
        const option = document.createElement('option');
        option.value = director;
        option.textContent = director;
        directorSelect.appendChild(option);
    });

    if (directors.has(currentSelection)) {
        directorSelect.value = currentSelection;
    }
}

function setupHero() {
    if (allMovies.length === 0) {
        heroBg.src = 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?q=80&w=1600&auto=format&fit=crop';
        heroTitle.textContent = 'Sua Biblioteca Virtual';
        heroYear.innerHTML = `<i class="fa-regular fa-calendar"></i> Catálogo`;
        heroScore.innerHTML = `<i class="fa-solid fa-star" style="color: var(--gold);"></i> --/100`;
        heroDuration.innerHTML = `<i class="fa-regular fa-clock"></i> -- min`;
        heroDesc.textContent = 'Adicione seus filmes favoritos usando a busca do TMDB no botão "Adicionar Filme" no canto superior direito.';
        heroSection.onclick = null;
        heroSection.style.cursor = 'default';
        return;
    }
    
    const randomIndex = Math.floor(Math.random() * allMovies.length);
    const featuredMovie = allMovies[randomIndex];

    heroBg.src = featuredMovie.movie_banner || featuredMovie.image;
    heroTitle.textContent = featuredMovie.title;
    heroYear.innerHTML = `<i class="fa-regular fa-calendar"></i> ${featuredMovie.release_date || 'N/A'}`;
    heroScore.innerHTML = `<i class="fa-solid fa-star" style="color: var(--gold);"></i> ${featuredMovie.rt_score}/100`;
    heroDuration.innerHTML = `<i class="fa-regular fa-clock"></i> ${featuredMovie.running_time} min`;
    heroDesc.textContent = featuredMovie.description;

    heroSection.style.cursor = 'pointer';
    heroSection.onclick = () => openModal(featuredMovie.id);
}

function applyFiltersAndSort() {
    const searchTerm = searchInput.value.toLowerCase().trim();
    const selectedDirector = directorSelect.value;
    const sortOption = sortSelect.value;

    filteredMovies = allMovies.filter(movie => {
        const matchesSearch = movie.title.toLowerCase().includes(searchTerm);
        const matchesDirector = selectedDirector === 'all' || movie.director === selectedDirector;
        
        let matchesQuickFilter = true;
        const year = parseInt(movie.release_date) || 0;
        const score = parseInt(movie.rt_score) || 0;
        const userRating = parseInt(movie.user_rating) || 0;

        if (currentQuickFilter === 'watchlist') {
            matchesQuickFilter = movie.status === 'watchlist';
        } else if (currentQuickFilter === 'watched') {
            matchesQuickFilter = movie.status === 'watched';
        } else if (currentQuickFilter === 'favorites') {
            matchesQuickFilter = userRating >= 4;
        } else if (currentQuickFilter === 'masterpiece') {
            matchesQuickFilter = score >= 80;
        } else if (currentQuickFilter === 'recent') {
            matchesQuickFilter = year >= 2020;
        } else if (currentQuickFilter === 'classic') {
            matchesQuickFilter = year > 0 && year < 2000;
        }

        return matchesSearch && matchesDirector && matchesQuickFilter;
    });

    if (sortOption === 'user-rating') {
        filteredMovies.sort((a, b) => (parseInt(b.user_rating) || 0) - (parseInt(a.user_rating) || 0));
    } else if (sortOption === 'rating-desc') {
        filteredMovies.sort((a, b) => (parseInt(b.rt_score) || 0) - (parseInt(a.rt_score) || 0));
    } else if (sortOption === 'rating-asc') {
        filteredMovies.sort((a, b) => (parseInt(a.rt_score) || 0) - (parseInt(b.rt_score) || 0));
    } else if (sortOption === 'year-desc') {
        filteredMovies.sort((a, b) => (parseInt(b.release_date) || 0) - (parseInt(a.release_date) || 0));
    } else if (sortOption === 'year-asc') {
        filteredMovies.sort((a, b) => (parseInt(a.release_date) || 0) - (parseInt(b.release_date) || 0));
    }

    renderCards();
}

function setQuickFilter(filterType) {
    currentQuickFilter = filterType;
    updateQuickPillState();
    applyFiltersAndSort();
}

function updateQuickPillState() {
    document.querySelectorAll('.quick-pills .pill').forEach(pill => {
        pill.classList.remove('active');
    });
    
    const activeId = `pill-${currentQuickFilter}`;
    const activePill = document.getElementById(activeId);
    if (activePill) activePill.classList.add('active');
}

function renderCards() {
    moviesGrid.innerHTML = '';
    
    resultsCountText.textContent = filteredMovies.length === 1 
        ? '1 filme encontrado' 
        : `${filteredMovies.length} filmes encontrados`;

    if (filteredMovies.length === 0) {
        moviesGrid.innerHTML = `
            <div class="no-results">
                <i class="fa-solid fa-clapperboard"></i>
                <p>Nenhum filme encontrado nesta seção.</p>
                <button class="btn-primary" onclick="openAddMovieModal()" style="margin-top: 15px;">
                    <i class="fa-solid fa-plus"></i> Adicionar Filme
                </button>
            </div>
        `;
        return;
    }

    filteredMovies.forEach(movie => {
        const status = movie.status || null;
        const userRating = movie.user_rating || 0;
        const isSelected = selectedMovieIds.has(movie.id);
        const card = document.createElement('div');
        card.classList.add('movie-card');
        if (status === 'watched') card.classList.add('is-watched');
        if (isSelected) card.classList.add('is-selected');

        const scoreNum = parseInt(movie.rt_score) || 0;
        let scoreClass = 'low';
        if (scoreNum >= 80) scoreClass = 'high';
        else if (scoreNum >= 65) scoreClass = 'mid';

        const checkboxHtml = isSelectionMode 
            ? `<div class="select-checkbox-overlay">${isSelected ? '<i class="fa-solid fa-check"></i>' : ''}</div>` 
            : '';

        const userStarHtml = userRating > 0 
            ? `<div class="user-rating-pill"><i class="fa-solid fa-heart"></i> ${userRating}/5</div>` 
            : '';

        card.innerHTML = `
            <div class="poster-container" onclick="handleCardClick('${movie.id}')">
                ${checkboxHtml}
                <img src="${movie.image}" class="movie-poster" alt="${movie.title}" loading="lazy" onerror="this.src='https://placehold.co/300x450/190a0e/ffffff?text=Sem+Poster'">
                <div class="score-badge ${scoreClass}">
                    <i class="fa-solid fa-star"></i> ${movie.rt_score}
                </div>
                ${status === 'watched' ? '<div class="watched-overlay-badge"><i class="fa-solid fa-check"></i> Assistido</div>' : ''}
                ${userStarHtml}
            </div>
            <div class="card-content">
                <h3 class="card-title" onclick="handleCardClick('${movie.id}')">${movie.title}</h3>
                <div class="card-meta">
                    <span>📅 ${movie.release_date || 'N/A'}</span>
                    <span>⏱️ ${movie.running_time} min</span>
                </div>
                <p class="card-desc">${movie.description}</p>
                
                <div class="card-actions">
                    <button class="btn-action ${status === 'watchlist' ? 'active' : ''}" 
                            onclick="setMovieStatus('${movie.id}', 'watchlist', event)" 
                            title="Quero Assistir">
                        <i class="fa-${status === 'watchlist' ? 'solid' : 'regular'} fa-bookmark"></i>
                        <span>${status === 'watchlist' ? 'Na Lista' : 'Quero Ver'}</span>
                    </button>
                    
                    <button class="btn-action btn-check ${status === 'watched' ? 'active' : ''}" 
                            onclick="setMovieStatus('${movie.id}', 'watched', event)" 
                            title="Marcar como Assistido">
                        <i class="fa-solid fa-check"></i>
                        <span>${status === 'watched' ? 'Visto' : 'Marcar Visto'}</span>
                    </button>
                </div>
            </div>
        `;

        moviesGrid.appendChild(card);
    });
}

function openModal(movieId) {
    const movie = allMovies.find(m => m.id === movieId);
    if (!movie) return;

    currentOpenMovieId = movieId;
    modalBannerImg.src = movie.movie_banner || movie.image;
    modalPosterImg.src = movie.image;
    modalTitle.textContent = movie.title;
    modalJapaneseTitle.textContent = movie.director;
    modalScore.textContent = `TMDB: ${movie.rt_score}/100`;
    modalYear.textContent = movie.release_date || 'N/A';
    modalDuration.textContent = `${movie.running_time} min`;
    modalSynopsisText.textContent = movie.description;
    modalDirector.textContent = movie.director;
    modalProducer.textContent = movie.producer || movie.director;

    // Carrega Avaliação Pessoal, Comentários e Onde Assistir
    renderStarRating(movie.user_rating || 0);
    modalPersonalNotes.value = movie.personal_notes || '';
    loadWatchProviders(movie);

    const deleteBtnContainer = document.getElementById('modal-delete-container');
    deleteBtnContainer.innerHTML = `
        <button class="btn-cancel" onclick="deleteMovie('${movie.id}', event)" style="color: #ff6b81; border-color: rgba(220, 20, 60, 0.4);">
            <i class="fa-solid fa-trash"></i> Excluir do Catálogo
        </button>
    `;

    modalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeModal() {
    currentOpenMovieId = null;
    modalOverlay.classList.remove('active');
    document.body.style.overflow = 'auto';
}

function closeModalOnOverlay(event) {
    if (event.target === modalOverlay) {
        closeModal();
    }
}

function openAddMovieModal() {
    addModalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeAddMovieModal() {
    addModalOverlay.classList.remove('active');
    document.body.style.overflow = 'auto';
    addMovieForm.reset();
    document.getElementById('form-tmdb-id').value = '';
    tmdbSearchInput.value = '';
    tmdbAutocompleteList.classList.remove('active');
    tmdbAutocompleteList.innerHTML = '';
}

function closeAddModalOnOverlay(event) {
    if (event.target === addModalOverlay) {
        closeAddMovieModal();
    }
}

tmdbSearchInput.addEventListener('input', () => {
    clearTimeout(searchDebounceTimeout);
    const query = tmdbSearchInput.value.trim();

    if (query.length < 2) {
        tmdbAutocompleteList.classList.remove('active');
        tmdbAutocompleteList.innerHTML = '';
        return;
    }

    searchDebounceTimeout = setTimeout(() => {
        searchTMDB(query);
    }, 400);
});

async function searchTMDB(query) {
    try {
        const url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&language=pt-BR&query=${encodeURIComponent(query)}&page=1&include_adult=false`;
        const res = await fetch(url);
        const data = await res.json();

        if (!data.results || data.results.length === 0) {
            tmdbAutocompleteList.innerHTML = '<div style="padding: 12px; font-size: 0.85rem; color: var(--text-muted);">Nenhum resultado encontrado.</div>';
            tmdbAutocompleteList.classList.add('active');
            return;
        }

        tmdbAutocompleteList.innerHTML = '';
        data.results.slice(0, 5).forEach(movie => {
            const item = document.createElement('div');
            item.classList.add('tmdb-item');
            
            const posterPath = movie.poster_path 
                ? `https://image.tmdb.org/t/p/w92${movie.poster_path}` 
                : 'https://placehold.co/35x50/190a0e/ffffff?text=Poster';
            
            const releaseYear = movie.release_date ? movie.release_date.split('-')[0] : 'N/A';

            item.innerHTML = `
                <img src="${posterPath}" class="tmdb-thumb" alt="${movie.title}">
                <div>
                    <div class="tmdb-info-title">${movie.title}</div>
                    <div class="tmdb-info-sub">${releaseYear} • ⭐ ${(movie.vote_average * 10).toFixed(0)}/100</div>
                </div>
            `;

            item.onclick = () => selectTMDBMovie(movie.id);
            tmdbAutocompleteList.appendChild(item);
        });

        tmdbAutocompleteList.classList.add('active');
    } catch (err) {
        console.error('Erro na busca TMDB:', err);
    }
}

async function selectTMDBMovie(tmdbId) {
    try {
        const url = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}&language=pt-BR&append_to_response=credits`;
        const res = await fetch(url);
        const movie = await res.json();

        let directorName = 'Desconhecido';
        if (movie.credits && movie.credits.crew) {
            const directorObj = movie.credits.crew.find(c => c.job === 'Director');
            if (directorObj) directorName = directorObj.name;
        }

        document.getElementById('form-tmdb-id').value = tmdbId;
        document.getElementById('form-title').value = movie.title || '';
        document.getElementById('form-year').value = movie.release_date ? movie.release_date.split('-')[0] : '';
        document.getElementById('form-duration').value = movie.runtime || 120;
        document.getElementById('form-director').value = directorName;
        document.getElementById('form-score').value = movie.vote_average ? Math.round(movie.vote_average * 10) : 80;
        document.getElementById('form-poster').value = movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : '';
        document.getElementById('form-banner').value = movie.backdrop_path ? `https://image.tmdb.org/t/p/original${movie.backdrop_path}` : '';
        document.getElementById('form-desc').value = movie.overview || 'Sinopse não disponível.';

        tmdbAutocompleteList.classList.remove('active');
        tmdbSearchInput.value = '';
    } catch (err) {
        console.error('Erro ao buscar detalhes:', err);
    }
}

async function handleAddNewMovie(event) {
    event.preventDefault();

    const title = document.getElementById('form-title').value.trim();
    const tmdbId = document.getElementById('form-tmdb-id').value.trim();

    // Prevenção de duplicatas no catálogo
    const alreadyExists = allMovies.some(m => 
        m.title.toLowerCase() === title.toLowerCase() || (tmdbId && m.tmdb_id === tmdbId)
    );

    if (alreadyExists) {
        showToast(`"${title}" já está no catálogo!`, 'fa-circle-exclamation');
        return;
    }

    btnSubmitMovie.disabled = true;
    btnSubmitMovie.textContent = "Salvando na nuvem...";

    const year = document.getElementById('form-year').value.trim();
    const duration = document.getElementById('form-duration').value.trim();
    const director = document.getElementById('form-director').value.trim();
    const score = document.getElementById('form-score').value.trim();
    const poster = document.getElementById('form-poster').value.trim();
    const banner = document.getElementById('form-banner').value.trim() || poster;
    const desc = document.getElementById('form-desc').value.trim();

    const newMovie = {
        tmdb_id: tmdbId || null,
        title: title,
        image: poster,
        movie_banner: banner,
        description: desc,
        director: director,
        producer: director,
        release_date: year,
        running_time: duration,
        rt_score: score,
        status: 'watchlist',
        user_rating: 0,
        personal_notes: '',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    try {
        await moviesCollection.add(newMovie);
        closeAddMovieModal();
        showToast(`"${title}" adicionado à lista Quero Ver!`);
    } catch (err) {
        console.error("Erro ao salvar no Firestore:", err);
        showToast("Erro ao salvar o filme no banco de dados.", "fa-triangle-exclamation");
    } finally {
        btnSubmitMovie.disabled = false;
        btnSubmitMovie.textContent = "Salvar no Catálogo";
    }
}

searchInput.addEventListener('input', applyFiltersAndSort);
sortSelect.addEventListener('change', applyFiltersAndSort);
directorSelect.addEventListener('change', applyFiltersAndSort);

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        if (modalOverlay.classList.contains('active')) closeModal();
        if (addModalOverlay.classList.contains('active')) closeAddMovieModal();
        if (isSelectionMode) toggleSelectionMode();
    }
});

function resetApp(event) {
    event.preventDefault();
    searchInput.value = '';
    sortSelect.value = 'popularity';
    directorSelect.value = 'all';
    currentQuickFilter = 'all';
    if (isSelectionMode) toggleSelectionMode();
    updateQuickPillState();
    applyFiltersAndSort();
    setupHero();
}

window.addEventListener('scroll', () => {
    const header = document.getElementById('main-header');
    if (window.scrollY > 50) {
        header.style.padding = '8px 0';
        header.style.background = 'rgba(12, 5, 7, 0.96)';
    } else {
        header.style.padding = '15px 0';
        header.style.background = 'var(--glass-bg)';
    }
});

initRealtimeSync();
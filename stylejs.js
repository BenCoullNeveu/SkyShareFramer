document.querySelectorAll('.group-title').forEach(title => {
    title.addEventListener('click', () => {
        const group = title.parentElement;
        group.classList.toggle('collapsed');
    });
});
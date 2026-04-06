let g, svg, treeLayout;
let currentTreeData = null;
let zoomBehavior = null;

// Chạy ngay khi load page
window.onload = () => fetchAllData();

// Chuyển Tab
function switchTab(tabId, btnElement) {
    document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    btnElement.classList.add('active');

    if(tabId === 'tab-tree' && currentTreeData) {
        setTimeout(() => drawTree(currentTreeData), 50);
    }
}

// Call API lấy data
async function fetchAllData() {
    const res = await fetch('/api/action', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({action: 'get_all'})
    });
    const data = await res.json();

    const tbody = document.getElementById('dict-body');
    tbody.innerHTML = '';
    data.words.forEach(w => {
        // Gắn ID cho từng dòng để tý nữa Highlight
        tbody.innerHTML += `<tr id="row-${w.word}"><td>${w.word}</td><td>${w.definition}</td></tr>`;
    });

    currentTreeData = data.tree;
    if (document.getElementById('tab-tree').classList.contains('active')) {
        drawTree(currentTreeData);
    }
}

// Search
async function handleSearch() {
    const word = document.getElementById('search-word').value.toLowerCase().trim();
    const msgBox = document.getElementById('search-result');
    if (!word) return msgBox.innerText = "Vui lòng nhập từ!";

    const res = await fetch('/api/action', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({action: 'search', word})
    });
    const data = await res.json();

    if (data.result.includes("Không tìm thấy")) {
        msgBox.style.color = 'var(--danger)';
        msgBox.innerText = "=> " + data.result;
    } else {
        msgBox.style.color = 'var(--success)';
        msgBox.innerText = "=> " + data.result;

        // Check tab nào bật
        const activeTab = document.querySelector('.tab-pane.active').id;

        if (activeTab === 'tab-list') {
            highlightTableRow(word);
        } else if (activeTab === 'tab-tree') {
            animatePath(word);
        }
    }
}

// High - light 10s
function highlightTableRow(word) {
    const row = document.getElementById(`row-${word}`);
    if (row) {
        row.classList.add('row-highlight');
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });

        setTimeout(() => {
            row.classList.remove('row-highlight');
        }, 10000);
    }
}

// Thêm/ xoá
async function handleManage(action) {
    const wordInput = document.getElementById('manage-word');
    const defInput = document.getElementById('manage-def');
    const word = wordInput.value.toLowerCase().trim();
    const definition = defInput.value.trim();
    const msgBox = document.getElementById('manage-msg');
    const deleteOptionsBox = document.getElementById('delete-options');

    if (action === 'delete') {
        if (!word) return msgBox.innerText = "Vui lòng nhập từ cần xóa!";
        msgBox.innerText = "Đang kiểm tra từ...";
        msgBox.style.color = "var(--text-main)";

        const searchRes = await fetch('/api/action', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({action: 'search', word})
        });
        const searchData = await searchRes.json();

        if (searchData.result.includes("Không tìm thấy")) {
            msgBox.style.color = 'var(--danger)';
            msgBox.innerText = "Từ này không tồn tại để xóa!";
            deleteOptionsBox.style.display = 'none';
            return;
        }

        const meanings = searchData.result.split(';').map(s => s.trim());

        if (meanings.length > 1) {
            let optionsHtml = `<p class="delete-options-title">Từ này có ${meanings.length} nghĩa. Tích chọn các nghĩa cần xóa:</p>`;
            meanings.forEach(m => {
                optionsHtml += `
                <label class="delete-option-item">
                    <input type="checkbox" value="${m}" class="delete-checkbox">
                    <span>${m}</span>
                </label>`;
            });
            optionsHtml += `
            <div style="display: flex; gap: 8px; margin-top: 12px;">
                <button class="btn-danger" style="flex: 1;" onclick="confirmDeleteMultiple('${word}')">
                    <i class="fas fa-trash-alt"></i> Xóa đã chọn
                </button>
                <button class="btn-primary" style="flex: 1; background: #64748b;" onclick="document.getElementById('delete-options').style.display='none'">
                    Hủy
                </button>
            </div>`;

            deleteOptionsBox.innerHTML = optionsHtml;
            deleteOptionsBox.style.display = 'block';
            msgBox.innerText = '';
            return;
        } else {
            if(!confirm(`Bạn có chắc muốn xóa hoàn toàn từ '${word}'?`)) {
                msgBox.innerText = "";
                return;
            }
        }
    }

    const res = await fetch('/api/action', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({action, word, definition})
    });
    const data = await res.json();

    if (data.error) {
        msgBox.style.color = 'var(--danger)';
        msgBox.innerText = data.error;
    } else {
        msgBox.style.color = 'var(--success)';
        msgBox.innerText = data.success || (action === 'add' ? "Đã thêm thành công!" : "Đã thao tác thành công!");
        deleteOptionsBox.style.display = 'none';

        wordInput.value = '';
        defInput.value = '';

        await fetchAllData();

        if (action === 'add') {
            if (!document.getElementById('tab-tree').classList.contains('active')) {
                document.querySelectorAll('.tab-btn')[1].click();
            }
            setTimeout(() => animatePath(word), 700);
        }
    }
}

// Xử lý gửi mảng Checkbox lên server
async function confirmDeleteMultiple(word) {
    const checkboxes = document.querySelectorAll('.delete-checkbox:checked');
    const selectedDefs = Array.from(checkboxes).map(cb => cb.value);
    const msgBox = document.getElementById('manage-msg');

    if (selectedDefs.length === 0) {
        msgBox.style.color = 'var(--danger)';
        msgBox.innerText = "Vui lòng chọn ít nhất 1 nghĩa để xóa!";
        return;
    }

    if(confirm(`Bạn có chắc muốn xóa ${selectedDefs.length} nghĩa đã chọn?`)) {
        const res = await fetch('/api/action', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({action: 'delete', word, definitions: selectedDefs})
        });
        const data = await res.json();

        if (data.error) {
            msgBox.style.color = 'var(--danger)';
            msgBox.innerText = data.error;
        } else {
            msgBox.style.color = 'var(--success)';
            msgBox.innerText = data.success;
            document.getElementById('delete-options').style.display = 'none';
            document.getElementById('manage-word').value = '';
            document.getElementById('manage-def').value = '';
            fetchAllData();
        }
    }
}

// Hàm Reset toàn bộ
async function handleReset() {
    if (confirm("CẢNH BÁO: Bạn có chắc chắn muốn xóa TOÀN BỘ từ điển không? Thao tác này KHÔNG THỂ khôi phục!")) {
        const res = await fetch('/api/action', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({action: 'reset'})
        });
        const data = await res.json();
        if (data.success) {
            alert(data.success);
            document.getElementById('manage-msg').innerText = '';
            document.getElementById('search-result').innerText = '';
            document.getElementById('search-word').value = '';
            fetchAllData();
        }
    }
}

// ----------------------------------------------------
// D3.JS ĐỒ HOẠ & ANIMATION CÂY
// ----------------------------------------------------

function initD3() {
    const canvas = document.getElementById('canvas');
    canvas.innerHTML = '';
    const width = canvas.clientWidth || 800;
    const height = canvas.clientHeight || 600;

    zoomBehavior = d3.zoom().on("zoom", (event) => g.attr("transform", event.transform));

    svg = d3.select("#canvas").append("svg")
        .attr("width", "100%").attr("height", "100%")
        .call(zoomBehavior);

    g = svg.append("g").attr("transform", `translate(${width/4}, ${height/2})`);
    treeLayout = d3.tree().nodeSize([50, 150]);
}

function drawTree(treeData) {
    if (!document.getElementById('canvas').clientWidth) return;
    if (!svg) initD3();

    const root = d3.hierarchy(treeData);
    treeLayout(root);

    const linkKey = d => d.target.data.name + d.target.depth;
    const nodeKey = d => d.data.name + d.depth;

    const links = g.selectAll(".link").data(root.links(), linkKey);

    const linkEnter = links.enter().append("path").attr("class", "link")
        .attr("d", d => {
            const o = {x: d.source.x, y: d.source.y};
            return d3.linkHorizontal().x(d => d.y).y(d => d.x)({source: o, target: o});
        })
        .style("opacity", 0);

    linkEnter.merge(links).transition().duration(600)
        .attr("d", d3.linkHorizontal().x(d => d.y).y(d => d.x))
        .style("opacity", 1);

    links.exit().remove();

    const nodes = g.selectAll(".node").data(root.descendants(), nodeKey);

    const nodeEnter = nodes.enter().append("g")
        .attr("class", d => "node " + (d.data.is_end ? "node--end" : ""))
        .attr("transform", d => `translate(${d.parent ? d.parent.y : d.y},${d.parent ? d.parent.x : d.x})`)
        .style("opacity", 0);

    nodeEnter.append("circle").attr("r", 14);
    nodeEnter.append("text").attr("x", 20).attr("dy", 5).text(d => d.data.name);

    nodeEnter.merge(nodes)
        .attr("class", d => "node " + (d.data.is_end ? "node--end" : ""))
        .transition().duration(600)
        .attr("transform", d => `translate(${d.y},${d.x})`)
        .style("opacity", 1);

    nodes.exit().remove();
}

// Logic Highlight tia sáng 10 giây
function animatePath(word) {
    if (!word || !currentTreeData) return;

    let remainingWord = word;
    let pathNodes = ["ROOT"];
    let depthLevels = [0];

    let node = currentTreeData;
    let currentDepth = 0;
    let i = 0;

    while (i < remainingWord.length && node.children) {
        let found = false;
        for (let child of node.children) {
            if (remainingWord.slice(i).startsWith(child.name)) {
                pathNodes.push(child.name);
                currentDepth++;
                depthLevels.push(currentDepth);
                i += child.name.length;
                node = child;
                found = true;
                break;
            }
        }
        if (!found) break;
    }

    pathNodes.forEach((name, idx) => {
        setTimeout(() => {
            let depth = depthLevels[idx];

            g.selectAll(".node")
             .filter(d => d.data.name === name && d.depth === depth)
             .select("circle")
             .transition().duration(200)
             .style("stroke", "#f59e0b")
             .style("stroke-width", "6px")
             .style("fill", "#fef08a")
             .transition().delay(10000).duration(500)
             .style("stroke", d => d.data.is_end ? "#059669" : "var(--primary)")
             .style("stroke-width", "3px")
             .style("fill", "white");

            if (idx > 0) {
                g.selectAll(".link")
                 .filter(d => d.target.data.name === name && d.target.depth === depth)
                 .transition().duration(200)
                 .style("stroke", "#f59e0b")
                 .style("stroke-width", "5px")
                 .transition().delay(10000).duration(500)
                 .style("stroke", "#cbd5e1")
                 .style("stroke-width", "2.5px");
            }
        }, idx * 300);
    });
}

// Phóng to thu nhỏ bằng kính lúp
function handleZoom(type) {
    if (!svg || !zoomBehavior) return;

    if (type === 'in') {
        svg.transition().duration(400).call(zoomBehavior.scaleBy, 1.4);
    } else if (type === 'out') {
        svg.transition().duration(400).call(zoomBehavior.scaleBy, 0.7);
    } else if (type === 'reset') {
        const width = document.getElementById('canvas').clientWidth || 800;
        const height = document.getElementById('canvas').clientHeight || 600;
        const transform = d3.zoomIdentity.translate(width/4, height/2).scale(1);
        svg.transition().duration(750).call(zoomBehavior.transform, transform);
    }
}
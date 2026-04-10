import sqlite3
import re
import os
from flask import Flask, render_template, request, jsonify

app = Flask(__name__)

# Cấu hình đường dẫn Database để chạy được trên Vercel (Read-only system)
# Nếu chạy trên Vercel, database sẽ nằm ở thư mục /tmp tạm thời
if os.environ.get('VERCEL'):
    DATABASE = '/tmp/dictionary.db'
else:
    DATABASE = 'dictionary.db'


def init_db():
    with sqlite3.connect(DATABASE) as conn:
        conn.execute('CREATE TABLE IF NOT EXISTS vocab (word TEXT PRIMARY KEY, definition TEXT)')


class RadixNode:
    def __init__(self, prefix="", is_end=False, definition=""):
        self.prefix = prefix
        self.is_end = is_end
        self.definition = definition
        self.children = {}

    def to_dict(self):
        return {
            "name": self.prefix if self.prefix else "ROOT",
            "is_end": self.is_end,
            "definition": self.definition,
            "children": [child.to_dict() for child in self.children.values()]
        }


class RadixTrie:
    def __init__(self):
        self.root = RadixNode()

    def insert(self, word, definition):
        node = self.root
        i = 0
        while i < len(word):
            char = word[i]
            if char not in node.children:
                node.children[char] = RadixNode(word[i:], True, definition)
                return
            child = node.children[char]
            j = 0
            while j < len(child.prefix) and i + j < len(word) and child.prefix[j] == word[i + j]:
                j += 1
            if j < len(child.prefix):
                new_node = RadixNode(child.prefix[j:], child.is_end, child.definition)
                new_node.children = child.children
                child.prefix = child.prefix[:j]
                child.is_end = False
                child.definition = ""
                child.children = {new_node.prefix[0]: new_node}
            i += j
            node = child
        node.is_end = True
        node.definition = definition

    def delete(self, word):
        def _delete(node, word):
            if not word:
                if not node.is_end: return False
                node.is_end = False
                return len(node.children) == 0
            char = word[0]
            if char not in node.children: return False
            child = node.children[char]
            if not word.startswith(child.prefix): return False
            if _delete(child, word[len(child.prefix):]):
                del node.children[char]
                if node != self.root and len(node.children) == 1 and not node.is_end:
                    only_child = list(node.children.values())[0]
                    node.prefix += only_child.prefix
                    node.is_end = only_child.is_end
                    node.definition = only_child.definition
                    node.children = only_child.children
                return len(node.children) == 0 and not node.is_end
            if len(child.children) == 1 and not child.is_end:
                only_grand = list(child.children.values())[0]
                child.prefix += only_grand.prefix
                child.is_end = only_grand.is_end
                child.definition = only_grand.definition
                child.children = only_grand.children
            return False

        _delete(self.root, word)

    def search(self, word):
        node = self.root
        i = 0
        while i < len(word):
            char = word[i]
            if char not in node.children: return None
            child = node.children[char]
            if word[i:].startswith(child.prefix):
                i += len(child.prefix)
                node = child
            else:
                return None
        return node.definition if node.is_end else None


# Khởi tạo DB và nạp dữ liệu vào Tree khi khởi động app
init_db()
trie = RadixTrie()
try:
    with sqlite3.connect(DATABASE) as conn:
        for row in conn.execute('SELECT word, definition FROM vocab'):
            trie.insert(row[0], row[1])
except Exception as e:
    print(f"Database loading error: {e}")


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/action', methods=['POST'])
def action():
    data = request.json
    action_type = data.get('action')
    word = data.get('word', '').lower().strip()
    definition = data.get('definition', '').strip()

    # Kiểm tra tính hợp lệ của từ vựng
    if action_type in ['add', 'delete', 'search']:
        if not word:
            return jsonify({"error": "Vui lòng nhập từ vựng!"})
        if not re.match(r'^[a-z]+$', word):
            return jsonify({"error": "Từ vựng chỉ được chứa chữ cái tiếng Anh (a-z)!"})

    if action_type == 'add':
        if not definition:
            return jsonify({"error": "Vui lòng nhập nghĩa của từ!"})

        existing_def = trie.search(word)
        if existing_def:
            existing_meanings = [d.strip() for d in existing_def.split(';')]
            if definition in existing_meanings:
                return jsonify({"error": f"Nghĩa '{definition}' đã tồn tại!"})
            new_definition = existing_def + " ; " + definition
        else:
            new_definition = definition

        trie.insert(word, new_definition)
        with sqlite3.connect(DATABASE) as conn:
            conn.execute('INSERT OR REPLACE INTO vocab VALUES (?, ?)', (word, new_definition))
        return jsonify({"success": f"Đã thêm từ '{word}'!", "tree": trie.root.to_dict()})

    elif action_type == 'delete':
        existing_def = trie.search(word)
        if not existing_def:
            return jsonify({"error": "Không tìm thấy từ này!"})

        targets = data.get('definitions', [])
        if targets:
            meanings = [d.strip() for d in existing_def.split(';')]
            for t in targets:
                if t in meanings: meanings.remove(t)

            if len(meanings) > 0:
                new_def = " ; ".join(meanings)
                trie.insert(word, new_def)
                with sqlite3.connect(DATABASE) as conn:
                    conn.execute('INSERT OR REPLACE INTO vocab VALUES (?, ?)', (word, new_def))
                return jsonify({"success": f"Đã xóa nghĩa của từ '{word}'!", "tree": trie.root.to_dict()})

        # Xóa hoàn toàn từ
        trie.delete(word)
        with sqlite3.connect(DATABASE) as conn:
            conn.execute('DELETE FROM vocab WHERE word = ?', (word,))
        return jsonify({"success": f"Đã xóa hoàn toàn từ '{word}'!", "tree": trie.root.to_dict()})

    elif action_type == 'search':
        res = trie.search(word)
        return jsonify({"result": res or "Không tìm thấy từ này!"})

    elif action_type == 'get_all':
        try:
            with sqlite3.connect(DATABASE) as conn:
                cursor = conn.execute('SELECT word, definition FROM vocab ORDER BY word')
                words = [{"word": row[0], "definition": row[1]} for row in cursor]
            return jsonify({"words": words, "tree": trie.root.to_dict()})
        except:
            return jsonify({"words": [], "tree": trie.root.to_dict()})

    elif action_type == 'reset':
        trie.root = RadixNode()
        with sqlite3.connect(DATABASE) as conn:
            conn.execute('DELETE FROM vocab')
        return jsonify({"success": "Đã làm mới toàn bộ dữ liệu!", "tree": trie.root.to_dict()})

    return jsonify({"tree": trie.root.to_dict()})


if __name__ == '__main__':
    app.run(debug=True)
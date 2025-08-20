from flask import Flask, request, jsonify
from flask_cors import CORS
import firebase_admin
from firebase_admin import credentials, firestore
import os
import tempfile
import subprocess
import sys
import json
import requests
from datetime import datetime
from dotenv import load_dotenv
import xml.etree.ElementTree as ET

app = Flask(__name__)
CORS(app)

# Load environment variables from .env file
load_dotenv()

# Initialize Firebase
if not firebase_admin._apps:
    if os.getenv('FIREBASE_PROJECT_ID'):
        cred = credentials.Certificate({
            "type": "service_account",
            "project_id": os.getenv('FIREBASE_PROJECT_ID'),
            "private_key": os.getenv('FIREBASE_PRIVATE_KEY', '').replace('\\n', '\n'),
            "client_email": os.getenv('FIREBASE_CLIENT_EMAIL'),
            "client_id": "",
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token"
        })
        firebase_admin.initialize_app(cred)
    else:
        firebase_admin.initialize_app()

db = firestore.client()

@app.route('/api/dataset', methods=['GET'])
def get_dataset():
    try:
        docs = db.collection('dataset').order_by('createdAt', direction=firestore.Query.DESCENDING).stream()
        items = []
        for doc in docs:
            data = doc.to_dict()
            items.append({
                'id': doc.id,
                **data
            })
        return jsonify(items)
    except Exception as e:
        return jsonify({'error': f'Failed to fetch dataset: {str(e)}'}), 500

@app.route('/api/dataset', methods=['POST'])
def create_dataset_item():
    try:
        data = request.json
        now = datetime.now().isoformat()
        
        new_item = {
            **data,
            'notes': data.get('notes', ''),
            'lastRunSuccessful': False,
            'createdAt': now,
            'updatedAt': now,
        }
        
        doc_ref = db.collection('dataset').add(new_item)
        doc = doc_ref[1].get()
        
        return jsonify({
            'id': doc.id,
            **doc.to_dict()
        })
    except Exception as e:
        return jsonify({'error': f'Failed to create dataset item: {str(e)}'}), 500

@app.route('/api/dataset/<item_id>', methods=['GET'])
def get_dataset_item(item_id):
    try:
        doc = db.collection('dataset').document(item_id).get()
        
        if not doc.exists:
            return jsonify({'error': 'Item not found'}), 404
        
        return jsonify({
            'id': doc.id,
            **doc.to_dict()
        })
    except Exception as e:
        return jsonify({'error': f'Failed to fetch dataset item: {str(e)}'}), 500

@app.route('/api/dataset/<item_id>', methods=['PUT'])
def update_dataset_item(item_id):
    try:
        data = request.json
        
        updated_item = {
            'lastRunSuccessful': False,
            **data,
            'notes': data.get('notes', ''),
            'updatedAt': datetime.now().isoformat(),
        }
        
        db.collection('dataset').document(item_id).update(updated_item)
        
        doc = db.collection('dataset').document(item_id).get()
        return jsonify({
            'id': doc.id,
            **doc.to_dict()
        })
    except Exception as e:
        return jsonify({'error': f'Failed to update dataset item: {str(e)}'}), 500

@app.route('/api/dataset/<item_id>', methods=['DELETE'])
def delete_dataset_item(item_id):
    try:
        db.collection('dataset').document(item_id).delete()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': f'Failed to delete dataset item: {str(e)}'}), 500

@app.route("/api/run-tests", methods=['POST'])
def run_tests_proxy():
    """
    This function acts as a proxy. It receives a request, forwards it to the
    Hugging Face API, and returns the response from Hugging Face.
    """
    # 1. Check if the HF_API_URL is configured
    HF_API_URL = "https://hostpython.onrender.com/api/run-tests"
    if not HF_API_URL:
        # Return a 500 Internal Server Error if the backend is not configured
        return jsonify({
            "success": False,
            "error": "Backend API endpoint is not configured on the server."
        }), 500

    # 2. Get the JSON payload from the incoming request
    try:
        incoming_data = request.get_json()
        if not incoming_data or "solution" not in incoming_data or "tests" not in incoming_data:
            return jsonify({
                "success": False,
                "error": "Request body must be valid JSON and include 'solution' and 'tests' keys."
            }), 400
    except Exception:
        return jsonify({"success": False, "error": "Invalid JSON in request body."}), 400

    # 3. Make the POST request to the Hugging Face API
    try:
        # Forward the exact same JSON payload to the Hugging Face API
        response = requests.post(
            HF_API_URL,
            json=incoming_data,
            headers={"Content-Type": "application/json"},
            timeout=45  # Set a timeout slightly longer than your HF Space's timeout (30s)
        )
        # This will raise an exception for 4xx/5xx server errors
        response.raise_for_status()

        # 4. Return the exact response from the Hugging Face API
        # We create a Flask response object using the content, status code,
        # and headers from the Hugging Face response.
        return app.response_class(
            response=response.content,
            status=response.status_code,
            mimetype=response.headers['Content-Type']
        )

    except requests.exceptions.Timeout:
        # The request to Hugging Face timed out
        return jsonify({
            "success": False,
            "error": "The request to the test runner service timed out.",
            "timeout": True
        }), 504  # 504 Gateway Timeout

    except requests.exceptions.RequestException as e:
        # This catches other network errors (connection failed, bad response from HF)
        return jsonify({
            "success": False,
            "error": f"Failed to communicate with the test runner service: {e}"
        }), 502  # 502 Bad Gateway

from google import genai
client = genai.Client(api_key=os.getenv("API_KEY"))
confJson = genai.types.GenerateContentConfig(
    response_mime_type="application/json",
)
@app.route('/api/suggest-topics', methods=['POST'])
def suggest_topics():
    if not request.is_json:
        return jsonify({"error": "Request must be JSON"}), 400

    data = request.get_json()
    problem_prompt = data.get('prompt')
    solution_code = data.get('solution')

    if not problem_prompt or not solution_code:
        return jsonify({"error": "Missing 'prompt' or 'solution' in request body"}), 400

    possible_topics = [
        "Array", "String", "Hash Table", "Dynamic Programming", "Math", "Sorting",
        "Greedy", "Depth-First Search", "Binary Search", "Database", "Matrix",
        "Tree", "Breadth-First Search", "Bit Manipulation", "Two Pointers",
        "Prefix Sum", "Heap (Priority Queue)", "Simulation", "Binary Tree",
        "Graph", "Stack", "Counting", "Sliding Window", "Design", "Enumeration",
        "Backtracking", "Union Find", "Linked List", "Number Theory", "Ordered Set",
        "Monotonic Stack", "Segment Tree", "Trie", "Combinatorics", "Bitmask",
        "Queue", "Divide and Conquer", "Recursion", "Geometry", "Binary Indexed Tree",
        "Memoization", "Hash Function", "Binary Search Tree", "Shortest Path",
        "String Matching", "Topological Sort", "Rolling Hash", "Game Theory",
        "Interactive", "Data Stream", "Monotonic Queue", "Brainteaser",
        "Doubly-Linked List", "Randomized", "Merge Sort", "Counting Sort",
        "Iterator", "Concurrency", "Probability and Statistics", "Quickselect",
        "Suffix Array", "Line Sweep", "Minimum Spanning Tree", "Bucket Sort",
        "Shell", "Reservoir Sampling", "Strongly Connected Component",
        "Eulerian Circuit", "Radix Sort", "Rejection Sampling", "Biconnected Component"
    ]


    prompt = f"""
    Analyze the following problem description and its solution code to identify the most relevant programming topics.
    From the provided list, please select the top 2 or 3 most applicable topics.

    Problem Prompt:
    {problem_prompt}

    Solution Code:
    ```
    {solution_code}
    ```

    Here is the list of possible topics to choose from:
    {json.dumps(possible_topics, indent=2)}

    Return your answer as a JSON array of strings. For example: ["Topic1", "Topic2"]
    """

    try:
        response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt,
                config=confJson
            )
        # Clean the response to extract the JSON part.
        # The model might add backticks and 'json' specifier.
        cleaned_response_text = response.text.strip().replace("```json", "").replace("```", "").strip()
        suggested_topics = json.loads(cleaned_response_text)
        return jsonify({"topics": suggested_topics})

    except Exception as e:
        # This will catch errors from the API call or JSON parsing
        print(f"An error occurred: {e}")
        return jsonify({"error": "Failed to generate or parse topics from the model."}), 500


if __name__ == '__main__':
    def run_test_scenario(scenario_name, solution_code, test_code):
        """Helper function to run a test scenario using the Flask test client."""
        print(f"--- RUNNING SCENARIO: {scenario_name} ---")
        with app.test_client() as client:
            response = client.post('/api/run-tests',
                                   data=json.dumps({
                                       'solution': solution_code,
                                       'tests': test_code
                                   }),
                                   content_type='application/json')
            print("Status Code:", response.status_code)
            print("Response JSON:")
            response_data = response.get_json()
            print(json.dumps(response_data, indent=2))
            print("--- END OF SCENARIO ---\n")

    # Scenario 1: Correct solution, all tests should pass
    passing_solution = "def add(a, b):\n    return a + b"
    passing_tests = (
        "def test_add_positive():\n"
        "    assert add(2, 3) == 5\n\n"
        "def test_add_negative():\n"
        "    assert add(-1, -1) == -2"
    )
    run_test_scenario("SUCCESSFUL RUN", passing_solution, passing_tests)

    # Scenario 2: Incorrect solution, some tests should fail
    failing_solution = "def add(a, b):\n    return a * b  # Bug: uses multiplication"
    failing_tests = (
        "def test_add_positive_fail():\n"
        "    assert add(2, 3) == 5\n\n"  # This will fail: 6 != 5
        "def test_add_identity_pass():\n"
        "    assert add(1, 5) == 5\n\n"  # This will pass: 5 == 5
        "def test_add_zero_fail():\n"
        "    assert add(5, 0) == 5"       # This will fail: 0 != 5
    )
    run_test_scenario("FAILING RUN", failing_solution, failing_tests)

    # Scenario 3: Code with a syntax error
    syntax_error_solution = "def my_func():\n    return True"
    syntax_error_tests = (
        "def test_syntax():\n"
        "    assert my_func() is True\n"
        "    this is an invalid line" # This will cause a syntax error
    )
    run_test_scenario("SYNTAX ERROR IN TEST", syntax_error_solution, syntax_error_tests)

    print("Starting Flask server for manual testing...")
    app.run(debug=True, host='127.0.0.1', port=5328)
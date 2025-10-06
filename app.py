from flask import Flask, request, jsonify
from flask_cors import CORS
import openai
import base64
import requests
from io import BytesIO
import os
import time
import json
import random
from threading import Lock

app = Flask(__name__)
CORS(app)

# Global variables to manage physical button state
button_press_state = {
    'button_pressed': None,
    'timestamp': None,
    'processed': True
}
button_lock = Lock()

openai.api_key = ""

def get_random_instruction():
    """Get a random instruction from the instructions.json file"""
    try:
        # Get the directory where app.py is located
        base_dir = os.path.dirname(os.path.abspath(__file__))
        instructions_file = os.path.join(base_dir, 'instructions.json')
        
        print(f"🔍 DEBUG: Looking for instructions file at: {instructions_file}")
        
        with open(instructions_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
            instructions = data.get('random_instructions', [])
            
        print(f"🔍 DEBUG: Found {len(instructions)} instructions in file")
        
        if instructions:
            selected = random.choice(instructions)
            print(f"🔍 DEBUG: Selected instruction: {selected[:50]}...")
            return selected
        else:
            print("🔍 DEBUG: No instructions found in file")
            return None
    except Exception as e:
        print(f"🔍 DEBUG: Error reading instructions.json: {e}")
        return None

def convert_to_past_tense(instruction):
    """Convert instruction text from present/imperative to past tense"""
    # Simple conversion rules for common instruction patterns
    conversions = {
        'add ': 'added ',
        'make it ': 'made it ',
        'make them ': 'made them ',
        'give it ': 'gave it ',
        'give them ': 'gave them ',
        'create ': 'created ',
        'introduce ': 'introduced ',
        'enhance ': 'enhanced ',
        'increase ': 'increased ',
        'reduce ': 'reduced ',
        'change ': 'changed ',
        'modify ': 'modified ',
        'adjust ': 'adjusted ',
        'transform ': 'transformed ',
        'apply ': 'applied ',
        'include ': 'included ',
        'incorporate ': 'incorporated ',
        'blend ': 'blended ',
        'shift ': 'shifted ',
        'deepen ': 'deepened ',
        'lighten ': 'lightened ',
        'darken ': 'darkened ',
        'soften ': 'softened ',
        'strengthen ': 'strengthened ',
        'intensify ': 'intensified ',
        'extend ': 'extended ',
        'expand ': 'expanded ',
        'compress ': 'compressed ',
        'rotate ': 'rotated ',
        'scale ': 'scaled ',
        'resize ': 'resized '
    }
    
    instruction_lower = instruction.lower()
    result = instruction
    
    for present, past in conversions.items():
        if instruction_lower.startswith(present):
            # Preserve original case
            if instruction[0].isupper():
                result = past.capitalize() + instruction[len(present):]
            else:
                result = past + instruction[len(present):]
            break
    
    return result

def remove_instruction_from_json(instruction_to_remove):
    """Remove a specific instruction from the instructions.json file"""
    try:
        # Get the directory where app.py is located
        base_dir = os.path.dirname(os.path.abspath(__file__))
        instructions_file = os.path.join(base_dir, 'instructions.json')
        
        # Read current instructions
        with open(instructions_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
            instructions = data.get('random_instructions', [])
        
        # Remove the instruction if it exists
        if instruction_to_remove in instructions:
            instructions.remove(instruction_to_remove)
            data['random_instructions'] = instructions
            
            # Write back to file
            with open(instructions_file, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=4, ensure_ascii=False)
            
            print(f"Removed instruction: {instruction_to_remove}")
            print(f"Remaining instructions: {len(instructions)}")
            return True
        else:
            print(f"Instruction not found: {instruction_to_remove}")
            return False
            
    except Exception as e:
        print(f"Error removing instruction from JSON: {e}")
        return False

def encode_image_to_base64(image_path_or_url):
    """Convert image to base64 for GPT-4 Vision"""
    try:
        if image_path_or_url.startswith('http'):
            # Download image from URL
            print(f"DEBUG: Downloading image from URL: {image_path_or_url}")
            response = requests.get(image_path_or_url)
            response.raise_for_status()
            image_data = response.content
        else:
            # For local files, construct the full path
            # Get the directory where app.py is located
            base_dir = os.path.dirname(os.path.abspath(__file__))
            full_path = os.path.join(base_dir, image_path_or_url)
            print(f"DEBUG: Trying to read local file: {full_path}")
            
            # Check if file exists
            if not os.path.exists(full_path):
                print(f"DEBUG: File not found: {full_path}")
                return None
            
            with open(full_path, 'rb') as image_file:
                image_data = image_file.read()
        
        print("DEBUG: Image successfully encoded to base64")
        return base64.b64encode(image_data).decode('utf-8')
    except Exception as e:
        print(f"Error encoding image: {e}")
        return None

def analyze_image_with_vision(image_path_or_url):
    """Analyze image using GPT-4o Vision and return detailed description"""
    print(f"DEBUG: Trying to analyze image: {image_path_or_url}")
    
    base64_image = encode_image_to_base64(image_path_or_url)
    if not base64_image:
        print("DEBUG: Failed to encode image to base64")
        return "Unable to analyze image - encoding failed"
    
    print("DEBUG: Image successfully encoded, calling Vision API...")
    
    try:
        response = openai.chat.completions.create(
            model="gpt-4o",  # Updated to use the current model with vision capabilities
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text", 
                            "text": "Analyze this image in detail. Describe the shapes, colors, composition, style, lighting, and any visual elements present. Be very specific and descriptive as this will be used to generate similar artwork variations."
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{base64_image}"
                            }
                        }
                    ]
                }
            ],
            max_tokens=400
        )
        result = response.choices[0].message.content
        print(f"DEBUG: Vision API response: {result[:100]}...")
        return result
    except Exception as e:
        print(f"Error analyzing image with Vision: {e}")
        return f"Error analyzing image: {str(e)}"

@app.route('/generate-text-variants', methods=['POST', 'OPTIONS'])
def generate_text_variants():
    if request.method == 'OPTIONS':
        return '', 200

    data = request.json
    prompt = data.get('prompt', '')
    history = data.get('history', [])
    image_url = data.get('imageUrl', 'CircleStart.png')

    try:
        # Analyze the current image with GPT-4 Vision
        print(f"Analyzing image: {image_url}")
        image_analysis = analyze_image_with_vision(image_url)
        print(f"Image analysis result: {image_analysis}")

        system_prompt = (
            "You are an art curator proposing very subtle, minimal changes to artworks. "
            "You will receive a detailed visual analysis of the current image and the user's choice history. "
            "Based on what you can see in the image analysis, propose two new variants that make VERY SMALL, SUBTLE changes only. "
            "Focus on: slight color shifts, minor shape adjustments, small texture changes, small style changes, or gentle lighting modifications. "
            "AVOID: dramatic transformations. "
            "Keep the core visual elements and composition similar to what's described in the analysis. "
            "Each variant should be a single paragraph describing the subtle modification. "
            "Base your proposals on the user's preferences as inferred from the history. "
            "Separate the two variants with the exact text '---VARIANT---' on its own line."
        )
        
        user_message = (
            f"CURRENT IMAGE ANALYSIS: {image_analysis}\n\n"
            f"Previous prompt context: {prompt}\n"
            f"User choice history: {history}\n\n"
            "Based on the visual analysis above, propose two new MINIMAL mutation ideas. "
            "Focus on very small changes that maintain most of what you see in the current image. "

            "IMPORTANT: Remember that the final image will be in VERTICAL/PORTRAIT format, so suggest changes that work well in tall compositions. "
            "Consider vertical elements, layers, or extensions that utilize the full height of the canvas. "
            "Separate variants with ---VARIANT---"
        )

        chat_response = openai.chat.completions.create(
            model="gpt-4-turbo",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message}
            ],
            n=1,
            max_tokens=400
        )
        content = chat_response.choices[0].message.content.strip()
        
        # Simple, reliable splitting using our custom delimiter
        variants = content.split('---VARIANT---')
        variants = [v.strip() for v in variants if v.strip()]
        
        # Ensure we have exactly 2 variants
        if len(variants) < 2:
            # Fallback: split on double newlines (paragraph breaks)
            variants = content.split('\n\n')
            variants = [v.strip() for v in variants if v.strip()]
        
        variants = variants[:2]

        return jsonify({
            'variants': variants,
            'debug_info': {
                'system_prompt': system_prompt,
                'user_message': user_message,
                'image_analysis': image_analysis
            }
        })
    except Exception as e:
        print("Backend error (generate-text-variants):", e)
        return jsonify({'error': str(e)}), 500

@app.route('/generate-image', methods=['POST'])
def generate_image():
    data = request.json
    prompt = data['prompt']
    image_url = data.get('imageUrl', 'CircleStart.png')

    try:
        # Get image analysis for context
        image_analysis = analyze_image_with_vision(image_url)
        
        # Get a random instruction to add creative variation
        random_instruction = get_random_instruction()
        print(f"🔍 DEBUG: Random instruction selected: {random_instruction}")
        random_instruction_text = f"\n\nAdditionally, {random_instruction}." if random_instruction else ""
        print(f"🔍 DEBUG: Random instruction text: {random_instruction_text}")
        
        # Create a more informed prompt based on the visual analysis
        final_prompt = (
            f"Based on this image analysis: {image_analysis}\n\n"
            f"Create a new image that implements this subtle change: {prompt}{random_instruction_text}\n\n"
            "IMPORTANT: Create a VERTICAL composition that fills the entire tall frame (portrait orientation). "
            "Extend the composition vertically, don't just center a square composition in the middle. "
            "Use the full height of the canvas with visual elements distributed throughout the vertical space. "
            "Maintain the same visual style, composition, colors, and overall appearance as described in the analysis, "
            "but adapt it to work beautifully in a tall vertical format. "
            "Make only the minimal change requested while utilizing the full vertical space."
        )
        
        response = openai.images.generate(
            model="dall-e-3",
            prompt=final_prompt,
            n=1,
            size="1024x1792"  # Formato verticale per monitor 2160x3840
        )
        
        generated_image_url = response.data[0].url

        print(f"🔍 DEBUG: About to return - random_instruction value: {random_instruction}")
        
        return jsonify({
            'modifiedImageUrl': generated_image_url,
            'debug_info': {
                'final_prompt': final_prompt,
                'image_analysis': image_analysis,
                'original_prompt': prompt,
                'random_instruction': random_instruction
            }
        })
    except Exception as e:
        print("Backend error (generate-image):", e)
        return jsonify({'error': str(e)}), 500

@app.route('/generate-reflection', methods=['POST', 'OPTIONS'])
def generate_reflection():
    if request.method == 'OPTIONS':
        return '', 200

    data = request.json
    prompt = data.get('prompt', '')
    history = data.get('history', [])

    try:
        reflection_prompt = (
            "Reflect critically on the process and reasoning behind proposing two variants for the following image mutation prompt, "
            "considering the user's choice history and inferred preferences. "
            "Write as if you are the curator, explaining your own reasoning and approach in detail, "
            "not in general but specifically on the user preferences and remembering all the choice history made by the user. "
            "But do not specify who you are, just write the reflection.\n"
            "The reflection must be maximum 200 characters.\n"
            f"Current prompt: {prompt}\nUser choice history: {history}"
        )
        reflection_response = openai.chat.completions.create(
            model="gpt-4-turbo",
            messages=[
                {"role": "system", "content": "You are a critical curator in an art gallery."},
                {"role": "user", "content": reflection_prompt}
            ],
            max_tokens=300
        )
        reflection = reflection_response.choices[0].message.content.strip()
        return jsonify({
            'reflection': reflection,
            'debug_info': {
                'reflection_prompt': reflection_prompt,
                'system_message': "You are a critical curator in an art gallery."
            }
        })
    except Exception as e:
        print("Backend error (generate-reflection):", e)
        return jsonify({'error': str(e)}), 500

@app.route('/physical-button-press', methods=['POST'])
def physical_button_press():
    """Endpoint to receive button presses from Raspberry Pi physical buttons"""
    global button_press_state
    
    try:
        data = request.json
        button_number = data.get('button')
        timestamp = data.get('timestamp')
        
        print(f"Physical button {button_number} pressed (timestamp: {timestamp})")
        
        with button_lock:
            button_press_state['button_pressed'] = button_number
            button_press_state['timestamp'] = timestamp
            button_press_state['processed'] = False
        
        return jsonify({'status': 'success', 'message': f'Button {button_number} press received'})
        
    except Exception as e:
        print(f"Error handling physical button press: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/check-button-press', methods=['GET'])
def check_button_press():
    """Endpoint for frontend to check if there was a physical button press"""
    global button_press_state
    
    with button_lock:
        if not button_press_state['processed'] and button_press_state['button_pressed']:
            # There is an unprocessed button press
            button = button_press_state['button_pressed']
            button_press_state['processed'] = True
            return jsonify({
                'button_pressed': True,
                'button': button,
                'timestamp': button_press_state['timestamp']
            })
        else:
            return jsonify({'button_pressed': False})

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint for Raspberry Pi"""
    return jsonify({
        'status': 'healthy',
        'timestamp': time.time(),
        'message': 'Flask app is running'
    })

@app.route('/button-status', methods=['GET'])
def button_status():
    """Endpoint to check physical buttons status"""
    with button_lock:
        return jsonify({
            'physical_buttons_enabled': True,
            'last_button_press': button_press_state['timestamp'],
            'last_button': button_press_state['button_pressed']
        })

@app.route('/remove-instruction', methods=['POST'])
def remove_instruction():
    """Endpoint to remove an instruction from the JSON when an image is discarded"""
    try:
        data = request.json
        instruction = data.get('instruction')
        
        if not instruction:
            return jsonify({'error': 'No instruction provided'}), 400
        
        success = remove_instruction_from_json(instruction)
        
        if success:
            return jsonify({
                'status': 'success',
                'message': f'Instruction removed: {instruction}',
                'action': 'instruction_removed'
            })
        else:
            return jsonify({
                'status': 'warning',
                'message': f'Instruction not found: {instruction}',
                'action': 'instruction_not_found'
            })
            
    except Exception as e:
        print(f"Error in remove_instruction endpoint: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/get-instructions-count', methods=['GET'])
def get_instructions_count():
    """Endpoint to get the current number of available instructions"""
    try:
        base_dir = os.path.dirname(os.path.abspath(__file__))
        instructions_file = os.path.join(base_dir, 'instructions.json')
        
        with open(instructions_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
            instructions = data.get('random_instructions', [])
            
        return jsonify({
            'count': len(instructions),
            'status': 'success'
        })
        
    except Exception as e:
        print(f"Error getting instructions count: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/generate_summary', methods=['POST'])
def generate_summary():
    """Generate a short summary (max 200 chars) + instruction for variant text"""
    try:
        data = request.json
        variant_text = data.get('variant_text', '')
        instruction = data.get('instruction', '')
        
        print(f"🔍 SUMMARY DEBUG: Input variant_text: {variant_text[:100]}...")
        print(f"🔍 SUMMARY DEBUG: Input instruction: {instruction}")
        
        if not variant_text:
            return jsonify({'error': 'variant_text is required'}), 400
        
        # Create prompt for OpenAI to summarize
        summary_prompt = f"""
        Please create a very concise summary of this text variant description in maximum 200 characters.
        Keep it engaging and descriptive but extremely brief.
        
        IMPORTANT: Write in past tense to show that these changes have already been applied to the image.
        Convert any future tense, imperatives, or "should" statements to past tense.
        For example: "enhance" → "enhanced", "add" → "added", "make it more" → "made it more"
        
        Text to summarize: {variant_text}
        
        Return only the summary in past tense, no additional text.
        """
        
        print(f"🔍 SUMMARY DEBUG: Calling OpenAI for summary...")
        
        # Call OpenAI to generate summary
        response = openai.chat.completions.create(
            model="gpt-4-turbo",
            messages=[
                {"role": "system", "content": "You are a concise text summarizer. Create very brief, engaging summaries."},
                {"role": "user", "content": summary_prompt}
            ],
            max_tokens=100,
            temperature=0.7
        )
        
        summary = response.choices[0].message.content.strip()
        print(f"🔍 SUMMARY DEBUG: Generated summary: {summary}")
        
        # Combine summary with instruction (convert instruction to past tense too)
        if instruction:
            # Convert instruction to past tense
            instruction_past = convert_to_past_tense(instruction)
            final_text = f"{summary}\n\n{instruction_past}"
        else:
            final_text = summary
            
        print(f"🔍 SUMMARY DEBUG: Final combined text: {final_text}")
        
        return jsonify({
            'summary': final_text,
            'original_summary': summary,
            'instruction': instruction,
            'status': 'success'
        })
        
    except Exception as e:
        print(f"Error generating summary: {e}")
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    # Test the instruction function on startup
    print("🧪 TESTING: get_random_instruction() function...")
    test_instruction = get_random_instruction()
    print(f"🧪 TEST RESULT: {test_instruction}")
    
    app.run(host='0.0.0.0', port=65500)  # Changed to 0.0.0.0 to accept connections from Raspberry Pi
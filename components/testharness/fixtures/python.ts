export const PY_SOLUTION_OK = `# LANG: python
def solve(x):
    return x * 2
`;

export const PY_TESTS_OK = `# LANG: python
import unittest
import solution

class TestSolve(unittest.TestCase):
    def test_double(self):
        self.assertEqual(solution.solve(2), 4)
    def test_zero(self):
        self.assertEqual(solution.solve(0), 0)

if __name__ == '__main__':
    unittest.main()
`;
